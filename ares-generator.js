/*jshint node: true, strict: false, globalstrict: false */

var fs = require("graceful-fs"),
    util = require('util'),
    request = require('request'),
    rimraf = require("rimraf"),
    path = require("path"),
    log = require('npmlog'),
    temp = require("temp"),
    async = require("async"),
    mkdirp = require("mkdirp"),
    nodezip = require('node-zip'),
    copyFile = require('./copyFile');

(function () {

	var generator = {};

	if (typeof setImmediate !== 'function') {
		// 
		// `setImmediate()` emulation for node<=0.8
		// 
		// WARNING: due to `Function#call` signature, we _have
		// to_ change the _this_ context passed to `next()`.
		//
		generator.setImmediate = function(next) {
			var args =  Array.prototype.slice.call(arguments);
			args.shift(1);
			process.nextTick(function() {
				next.apply(null, args);
			});
		};
	} else {
		generator.setImmediate = setImmediate;
	}

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = generator;
	}

	var objectCounter = 0;

	var isArray = Array.isArray || function(a) {
		return (!!a) && (a.constructor === Array);
	};
	var isObject = function(a) {
		return (!!a) && (a.constructor === Object);
	};
	var isString = function(a) {
		return (!!a) && (a.constructor === String);
	};

	//var dotFiles = new RegExp("(^|/|\\\\)\\.");

	function Generator(config, next) {
		if (!isObject(config)) {
			generator.setImmediate(next, new Error("Invalid configuration:" + config));
			return;
		}
		if (!isArray(config.sources)) {
			generator.setImmediate(next, new Error("Invalid sources:" + config.sources));
			return;
		}
		this.config = config;
		this.objectId = objectCounter++;
		var sources = {};
		try {
			log.silly("Generator()", "Checking config.sources:", config.sources);
			config.sources.forEach(function(source) {
				log.silly("Generator()", "Checking source:", source);
				if ((isString(source.id)) && 
				    (isString(source.type)) && 
				    (isString(source.description)) &&
				    (isArray(source.files))) {
					sources[source.id] = source;
					log.verbose("Generator()", "Loaded source:", source);
				} else if ((typeof source.id === 'string') && (source.type === 'null')) {
					if (sources[source.id]) {
						delete sources[source.id];
						log.verbose("Generator()", "Removed source:", source.id);
					} else {
						throw new Error("Unable to remove source: " + source.id + " does not exist");
					}
				} else {
					throw new Error("Incomplete source:" + util.inspect(source));
				}
			});
		} catch(err) {
			generator.setImmediate(next, err);
			return;
		}
		this.config.sources = sources;

		log.info("Generator()", "config:", util.inspect(this.config, {depth: null}));
		generator.setImmediate(next, null, this);
	}

	generator.Generator = Generator;
	
	generator.create = function(config, next) {
		return new Generator(config, next);
	};

	Generator.prototype = {

		/**
		 * List configuration: sources
		 * @public
		 * @param {String} type source type, in ['template', 'lib', 'webos-service', ...]
		 * @param {Function} next commonJS callback
		 * @param next {Error} err 
		 * @param next {Array} sources
		 * @item sources {Object} id
		 * @item sources {Object} type in ['template', 'lib', 'webos-service', ...]
		 * @item sources {Object} [version]
		 * @item sources {Object} description
		 * @item sources {Object} [deps]
		 */
		getSources: function(type, next) {
			var outSources,
			    sources = this.config.sources,
			    sourceIds = Object.keys(sources);
			sourceIds = sourceIds && sourceIds.filter(function(sourceId) {
				return type && (sources[sourceId].type === type);
			});
			log.verbose("Generator#getSource()", "type:", type, "sourceIds:", sourceIds);
			outSources = sourceIds && sourceIds.map(function(sourceId) {
				var source = sources[sourceId];
				return {
					type: source.type,
					id: source.id,
					version: source.version,
					description: source.description,
					deps: source.deps || []
				};
			});
			generator.setImmediate(next, null, outSources);
		},

		generate: function(sourceIds, substitutions, destination, options, next) {
			log.info("generate()", "sourceIds:", sourceIds);
			var self = this;
			var session = {
				fileList: [],
				substitutions: substitutions,
				destination: destination
			};
			options = options || {};

			// Enrich the list of option Id's by recursing into the dependencies
			sourceIds = sourceIds || [];
			var sourcesObject = {};
			_addSources(sourceIds);

			function _addSources(sourceIds) {
				sourceIds.forEach((function(sourceId) {
					if (sourcesObject[sourceId]) {
						// option already listed: skip
						return;
					} else {
						// option not yet listed: recurse
						var source = self.config.sources[sourceId];
						if (source) {
							sourcesObject[sourceId] = source;
							source.deps = source.deps || [];
							_addSources(source.deps);
						}
					}
				}));
			}
				
			log.verbose("generate()", "consolidated sourceIds:", Object.keys(sourcesObject));

			// now that sources are uniquelly identified
			// via object properties, convert them back
			// into an array for iteration.
			var sources = Object.keys(sourcesObject).map(function(sourceId) {
				return self.config.sources[sourceId];
			});
			log.verbose("generate()", "sources:", sources);

			// extend built-in substitutions using plugin-provided ones
			/*
			log.verbose("generate()", "tmpl.substitutions:", tmpl.substitutions);
			if (tmpl.substitutions) {
				var sm = Object.keys(substitutions).concat(Object.keys(tmpl.substitutions));
				sm.forEach(function(m) {
					var s = substitutions[m],
					    ts = tmpl.substitutions[m];
					if (Array.isArray(ts)) {
						if (Array.isArray(s)) {
							s = s.concat(ts);
						} else {
							s = ts;
						}
					}
					substitutions[m] = s;
				});
			}
			 */
			log.info("generate()", "substitutions:", substitutions);

			// Do not overwrite the target directory (as a
			// whole) in case it already exists.
			if (!options.overwrite && fs.existsSync(destination)) {
				generator.setImmediate(next, new Error("'" + destination + "' already exists"));
				return;
			}

			async.waterfall([
				temp.mkdir.bind(null, {
					prefix: 'com.enyojs.ares.generator.folder',
					suffix: ".d"
				}),
				function(tmpDir, next) {
					session.tmpDir = tmpDir;
					log.silly("generate()", "session.tmpDir:", session.tmpDir);
					generator.setImmediate(next);
				},		
				async.forEachSeries.bind(self, sources, _processSource.bind(self)),
				_substitute.bind(self, session),
				_realize.bind(self, session),
				function(next) {
					rimraf(session.tmpDir, next);
				}
			], function _notifyCaller(err) {
				if (err) {
					// delete tmpDir & trampoline the error
					rimraf(session.tmpDir, function() {
						next(err);
					});
					return;
				}
				// return the list of generated files,
				// relative to the given destination
				// folder (if given), otherwise return
				// the explicit mapping.
				if (session.destination) {
					next(null, session.fileList.map(function(file) {
						return file.name;
					}));
				} else {
					next(null, session.fileList);
				}
			});

			function _processSource(source, next) {
				log.silly("generate#_processSource()", "processing source:", source);
				async.forEachSeries(source.files, _processSourceItem.bind(self), next);
			}

			function _processSourceItem(item, next) {
				if ((path.extname(item.url).toLowerCase() === ".zip") ||
				    (path.extname(item.alternateUrl).toLowerCase() === ".zip")) {
					_processZipFile(item, _out);
				} else {
					fs.stat(item.url, function(err, stats) {
						if (err) {
							_out(err);
						} else if (stats.isDirectory()) {
							_processFolder(item, _out);
						} else if (stats.isFile()){
							_processFile(item, _out);
						} else {
							next(new Error("Don't know how to handle '" + item.url + "'"));
						}
					});
				}

				function _out(err, fileList) {
					log.silly("generate#_processSourceItem#_out()", "arguments:", arguments);
					if (err) {
						return next(err);
					} else {
						log.silly("generate#_processSourceItem#_out()", "fileList:", fileList);
						if (Array.isArray(fileList)) {
							// XXX here we do not replace existing entries:
							// we append new ones to the list.
							session.fileList = session.fileList.concat(fileList);
						}
						next();
					}
				}
			}

			function _processFile(item, next) {
				log.info("generate#_processFile()", "Processing:", item.url);
				generator.setImmediate(next, null, [{
					name: item.installAs,
					path: item.url
				}]);
			}

			function _processZipFile(item, next) {
				log.info("generate#_processZipFile()", "Processing:", item.url);
				var context = {
					item: item
				};
				temp.mkdir({
					dir: session.tmpDir,
					prefix: "zip",
					suffix: ".d"
				}, (function(err, tmpDir) {
					if (err) {
						next(err);
						return;
					}
					// all those dirs will be
					// cleaned when `tmpDir` will
					// go out of scope.
					context.archive = path.join(tmpDir, "archive");
					context.workDir = path.join(tmpDir, "work");
					context.destDir = destination;
					context.fileList = [];

					async.series([
						_fetchFile.bind(self, context),
						fs.mkdir.bind(this, context.workDir),
						_unzipFile.bind(self, context),
						_removeExcludedFiles.bind(self, context),
						_prefix.bind(self, context)
					], function _out(err) {
						log.verbose("generate#_processZipFile#_out()", "fileList.length:", context.fileList.length);
						log.silly("generate#_processZipFile#_out()", "fileList:", context.fileList);
						next(err, context.fileList);
					});
				}));
			}

			function _processFolder(item, next) {
				log.info("generate#_processFolder()", "Processing:", item.url);
				var context = {
					item: item
				};

				var _normalize;
				if (process.platform === 'win32') {
					_normalize = function(p) {
						return p && typeof p === 'string' && p.replace(/\\/g,'/');
					};
				} else {
					_normalize = function(p) {
						return p;
					};
				}

				context.fileList = [];
				context.workDir = item.url;
				context.destDir = destination;

				async.series([
					_walk.bind(null, context, ".", item.url),
					_removeExcludedFiles.bind(self, context),
					_prefix.bind(self, context)
				], function _out(err) {
					log.verbose("generate#_processFolder#_out()", "fileList.length:", context.fileList.length);
					log.silly("generate#_processFolder#_out()", "fileList:", context.fileList);
					next(err, context.fileList);
				});

				function _walk(context, dirName, dirPath, next) {
					//log.silly("generate#_processFolder#_walk()", "arguments:", arguments);
					async.waterfall([
						fs.readdir.bind(null, dirPath),
						function(fileNames, next) {
							//log.silly("generate#_processFolder#_walk()", "fileNames:", fileNames, "dirPath:", dirPath);
							async.forEach(fileNames, function(fileName, next) {
								//log.silly("generate#_processFolder#_walk()", "fileName:", fileName, "dirPath:", dirPath);
								var filePath = path.join(dirPath, fileName);
								async.waterfall([
									fs.stat.bind(null, filePath),
									function(stat, next) {
										var name = _normalize(path.join(dirName, fileName));
										if (stat.isFile()) {
											context.fileList.push({name: name, path: filePath});
											generator.setImmediate(next);
										} else {
											_walk(context, name, filePath, next);
										}
									}
								], next);
							}, next);
						}
					], function(err) {
						if (err) {
							return next(err);
						}
						log.silly("generate#_processFolder#_walk()", "fileList.length:", context.fileList.length);
						//log.silly("generate#_processFolder#_walk()", "fileList:", context.fileList);
						next();
					});
				}
			}
		}
	};

	// This method works both on node-0.8 & node-0.10 (do not
	// laugh, this is not easy to achieve...)
	function _fetchFile(context, next) {
		log.silly("Generator#_fetchFile()");
		try {
			var url = context.item.url;

			if (fs.existsSync(url)) {
				context.archive = url;
				generator.setImmediate(next);
				return;
			}

			if (url.substr(0, 4) !== 'http') {
				generator.setImmediate(next, new Error("Source '" + url + "' does not exists"));
				return;
			}

			log.http("Generator#_fetchFile()", "GET", url, "=>", context.archive);
			log.http("Generator#_fetchFile()", "using proxy:", this.config.proxyUrl);
			request({
				url: url,
				proxy: this.config.proxyUrl
			}).pipe(
				fs.createWriteStream(context.archive).on('close', next)
			);
		} catch(err) {
			log.error("Generator#_fetchFile()", err);
			generator.setImmediate(next, err);
		}
	}

	function _unzipFile(context, next) {
		log.silly("Generator#_unzipFile()", context.archive, "=>", context.workDir);
		var fileList = [];
		/*
		 * WARNING: we use `node-zip` & load the entire zip-archive in memory,
		 * because `node-unzip@0.1.8` streams do not work in `nodejs@0.10`.
		 * A development branch of `node-unzip@0.1.7` works on nodejs@0.10, but
		 * not on `nodejs@0.8.x`.
		 */
		async.waterfall([
			fs.readFile.bind(fs, context.archive, 'binary'),
			function(arBuf, next) {
				log.silly("Generator#_unzipFile()", "zip length:", arBuf.length);
				var ar;
				try {
					ar = new nodezip(arBuf, { base64: false, checkCRC32: false });
				} catch(err) {
					next(err);
					return;
				}
				log.silly("Generator#_unzipFile()", 'ar:', util.inspect(Object.keys(ar)));
				log.silly("Generator#_unzipFile()", 'ar.root:', ar.root);
				async.forEachSeries(Object.keys(ar.files), function(fileKey, next) {
					var file = ar.files[fileKey], encoding;
					log.silly("Generator#_unzipFile()", "file.name:", file.name);
					log.silly("Generator#_unzipFile()", "file.options:", file.options);
					var fileName = path.join(context.workDir, file.name);
					async.series([
						mkdirp.bind(null, path.dirname(fileName)),
						function(next) {
							if (file.options.dir) {
								log.silly("Generator#_unzipFile()", "mkdir", fileName);
								fs.mkdir(fileName, next);
							} else {
								log.silly("Generator#_unzipFile()", "write", fileName);
								if (file.options.binary) {
									encoding = 'binary';
								} else if (file.options.base64) {
									encoding = 'base64';
								} else {
									encoding = 'utf8';
								}
								var buf = new Buffer(file.data, encoding);
								fs.writeFile(fileName, buf, next);
							}
						},
						function(next) {
							if (!file.options.dir) {
								fileList.push({	path: fileName, name: file.name });
							}
							generator.setImmediate(next);
						}
					], next);
				}, next);
			}
		], function(err) {
			log.silly("Generator#_unzipFile()", "fileList:", fileList);
			context.fileList = fileList;
			next(err);
		});
	}

	function _removeExcludedFiles(context, next) {
		var fileList = context.fileList;
		log.silly("Generator#_removeExcludedFiles()", "input fileList:", fileList);

		var excluded = context.item.excluded;
		log.verbose("Generator#_removeExcludedFiles()", "excluded:", excluded);

		fileList = fileList.filter(function(file) {
			var skip = false;
			// Skipping dotfiles can lead to un-expected
			// effetcts in node sub-modules...
			if (false /*dotFiles.test(file.name)*/) {
				skip = true;
			} else if (!skip && Array.isArray(excluded)) {
				excluded.forEach(function(exclude) {
					var len = exclude.length;
					skip = skip || (file.name.substr(0, len) === exclude);
				});
			}
			if (skip) {
				log.verbose("Generator#_removeExcludedFiles()", "skipping:", file.name);
			}
			return !skip;
		});
		log.silly("Generator#_removeExcludedFiles()", "output fileList:", fileList);
		context.fileList = fileList;
		generator.setImmediate(next);
	}

	function _prefix(context, next) {
		log.silly("Generator#_prefix()", "item:", context.item);
		log.silly("Generator#_prefix()", "input fileList:", context.fileList);
		var len, fileList = context.fileList,
		    prefixToRemove = context.item.prefixToRemove,
		    prefixToAdd = context.item.prefixToAdd;

		// filter-out files whose name starts by `prefixToRemove`
		if (prefixToRemove && Array.isArray(fileList)) {
			prefixToRemove += '/';
			len = prefixToRemove.length;
			fileList = fileList.map(function(file) {
				if (file.name.substr(0, len) === prefixToRemove) {
					var newName = file.name.substr(len);
					log.silly("Generator#_prefix()", file.name, "->", newName);
					file.name = newName;
					return file;
				} else {
					return undefined;
				}
			});
			fileList = fileList.filter(function(file) {
				return !!file;
			});
		}

		// relocate every file name under `prefixToAdd`
		if (prefixToAdd && Array.isArray(fileList)) {
			prefixToAdd += '/';
			fileList = fileList.map(function(file) {
				var newName = prefixToAdd + file.name;
				log.silly("Generator#_prefix()", file.name, "->", newName);
				file.name = newName;
				return file;
			});
		}

		// put back into the context
		log.silly("Generator#_prefix()", "output fileList:", fileList);
		context.fileList = fileList;
		generator.setImmediate(next);
	}

	function _substitute(session, next) {
		//log.silly("Generator#_substitute()", "arguments:", arguments);
		var substits = session.substitutions || [];
		log.verbose("_substitute()", "input fileList.length:", session.fileList.length);
		log.verbose("_substitute()", "substits:", substits);

		async.forEachSeries(substits, function(substit, next) {
			log.silly("_substitute()", "applying substit:", substit);
			var regexp = new RegExp(substit.fileRegexp);
			async.forEachSeries(session.fileList, function(file, next) {
				log.silly("_substitute()", regexp, "matching? file.name:", file.name);
				if (regexp.test(file.name)) {
					log.verbose("_substitute()", "matched file:", file);
					if (substit.json) {
						log.verbose("_substitute()", "Applying JSON substitutions to:", file);
						_applyJsonSubstitutions(file, substit.json, next);
					}
					if (substit.vars) {
						log.verbose("_substitute()", "Applying VARS substitutions to", file);
						_applyVarsSubstitutions(file, substit.vars, next);
					}
				} else {
					next();
				}
			}, next);
		}, next);
		
		function _applyJsonSubstitutions(file, json, next) {
			log.verbose("_applyJsonSubstitutions()", "substituting json:", json, "in", file);
			async.waterfall([
				fs.readFile.bind(null, file.path, {encoding: 'utf8'}),
				function(content, next) {
					log.silly("_applyJsonSubstitutions()", "loaded JSON string:", content);
					content = JSON.parse(content);
					log.silly("_applyJsonSubstitutions()", "content:", content);
					var modified, keys = Object.keys(json);
					keys.forEach(function(key) {
						if (content.hasOwnProperty(key)) {
							log.verbose("_applyJsonSubstitutions()", "apply", key, ":", json[key]);
							content[key] = json[key];
							modified = true;
						}
					});
					log.silly("_applyJsonSubstitutions()", "modified:", modified, "content:", content);
					if (modified) {
						file.path = temp.path({dir: session.tmpDir, prefix: "subst.json."});
						log.silly("_applyJsonSubstitutions()", "update as file:", file);
						fs.writeFile(file.path, JSON.stringify(content, null, 2), {encoding: 'utf8'}, next);
					} else {
						generator.setImmediate(next);
					}
				}
			], next);
		}
		
		function _applyVarsSubstitutions(file, changes, next) {
			log.verbose("_applyVarsSubstitutions()", "substituting variables in", file);
			async.waterfall([
				fs.readFile.bind(null, file.path, {encoding: 'utf-8'}),
				function(content, next) {
					Object.keys(changes).forEach(function(key) {
						var value = changes[key];
						log.silly("_applyVarsSubstitutions()", "key=" + key + " -> value=" + value);
						content = content.replace("${" + key + "}", value);
					});
					file.path = temp.path({dir: session.tmpDir, prefix: "subst.vars."});
					fs.writeFile(file.path, JSON.stringify(content, null, 2), {encoding: 'utf8'}, next);
				}
			], next);
		}
	}

	function _realize(session, next) {
		var dstDir = session.destination,
		    fileList = session.fileList;
		log.verbose("generate#_realize()", "dstDir:", dstDir, "fileList.length:", fileList.length);
		if (dstDir) {
			async.forEachSeries(fileList, function(file, next) {
				var dst = path.join(dstDir, file.name);
				log.silly('generate#_realize()', dst, "<-", file.path);
				async.series([
					mkdirp.bind(null, path.dirname(dst)),
					copyFile.bind(null, file.path, dst)
				], next);
			}, next);
		} else {
			generator.setImmediate(next);
		}
	}
}());
