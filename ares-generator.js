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
    extract = require("extract-zip"),
    copyDir = require('./copyDir'),
    copyFile = require('./copyFile');

(function () {

	var generator = {};

	if (process.platform === 'win32') {
		generator.normalizePath = function(p) {
			return p && typeof p === 'string' && p.replace(/\\/g,'/');
		};
	} else {
		generator.normalizePath = function(p) {
			return p;
		};
	}

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = generator;
	}

	var objectCounter = 0;

	var isObject = function(a) {
		return (!!a) && (a.constructor === Object);
	};
	var isString = function(a) {
		return (!!a) && (a.constructor === String);
	};

	function Generator(config, next) {
		if (!isObject(config)) {
			setImmediate(next, new Error("Invalid configuration:" + config));
			return;
		}
		if (!Array.isArray(config.sources)) {
			setImmediate(next, new Error("Invalid sources:" + config.sources));
			return;
		}
		this.config = config;
		log.level = config.level || 'http';
		this.objectId = objectCounter++;
		var sources = {};
		try {
			log.silly("Generator()", "Checking config.sources:", config.sources);
			config.sources.forEach(function(source) {
				log.silly("Generator()", "Checking source:", source);
				if ((typeof source.id === 'string') && (source.type === null)) {
					if (sources[source.id]) {
						delete sources[source.id];
						log.verbose("Generator()", "Removed source:", source.id);
					} else {
						log.verbose("Generator()", "No such source to remove '", source.id, "'");
					}
				} else if ((isString(source.id)) && 
				    (isString(source.type)) && 
				    (isString(source.description)) &&
				    (Array.isArray(source.files))) {
					sources[source.id] = source;
					log.verbose("Generator()", "Loaded source:", source);
				} else {
					throw new Error("Incomplete or invalid source:" + util.inspect(source));
				}
			});
		} catch(err) {
			setImmediate(next, err);
			return;
		}
		this.config.sources = sources;

		log.info("Generator()", "config:", util.inspect(this.config, {depth: null}));
		setImmediate(next, null, this);
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
			log.verbose("Generator#getSources()", "type:", type, "sourceIds:", sourceIds);
			outSources = sourceIds && sourceIds.map(function(sourceId) {
				var source = sources[sourceId];
				return {
					type: source.type,
					id: source.id,
					version: source.version,
					description: source.description,
					isDefault: source.isDefault || false,
					deps: source.deps || []
				};
			});
			log.silly("Generator#getSources()", "sources:", outSources);
			setImmediate(next, null, outSources);
		},

		generate: function(sourceIds, substitutions, destination, options, next) {
			log.info("generate()", "sourceIds:", sourceIds);
			log.verbose("generate()", "config.sources:", this.config.sources);
			var self = this;
			var session = {
				fileList: [],
				linkList: [],
				substitutions: substitutions,
				destination: destination
			};
			options = options || {};

			// Enrich the list of option Id's by recursing into the dependencies
			sourceIds = sourceIds || [];
			var sourcesObject = {};
			_addSources(sourceIds);

			function _addSources(sourceIds) {
				log.verbose("generate#_addSources()", "adding sources:", sourceIds);
				sourceIds.forEach((function(sourceId) {
					if (sourcesObject[sourceId]) {
						// option already listed: skip
						return;
					} else {
						// option not yet listed: recurse
						var source = self.config.sources[sourceId];
						log.silly("generate#_addSources()", " sourceId:", sourceId, "=> source:", source);
						if (source) {
							sourcesObject[sourceId] = source;
							source.deps = source.deps || [];
							_addSources(source.deps);
						}
					}
				}));
			}
				
			log.info("generate()", "will use sourceIds:", Object.keys(sourcesObject));

			// now that sources are uniquely identified
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
				setImmediate(next, new Error("'" + destination + "' already exists"));
				return;
			}

			async.series([
				function(next) {
					session.tmpDir = temp.path({prefix: 'com.enyojs.ares.generator.', suffix: '.d'});
					mkdirp(session.tmpDir, next);
				},
				function(next) {
					log.silly("generate()", "session.tmpDir:", session.tmpDir);
					setImmediate(next);
				},		
				async.forEachSeries.bind(self, sources, _processSource.bind(self)),
				_substitute.bind(self, session),
				_realize.bind(self, session),
				_symlink.bind(self, session)
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
					// does no longer refer to
					// anything outside
					// `destination`: delete
					// `tmpDir` first
					rimraf(session.tmpDir, function() {
						next(null, session.fileList.map(function(file) {
							return file.name;
						}));
					});
				} else {
					// still refers to temporary
					// files: delete `tmpDir`
					// later
					next(null, session.fileList, session.tmpDir);
				}
			});

			function _processSource(source, next) {
				log.silly("generate#_processSource()", "processing source:", source);
				async.forEachSeries(source.files, _processSourceItem.bind(self), next);
			}

			function _processSourceItem(item, next) {
				if (!item.url) {
					// simply ignore entries that
					// do not have (or have a
					// commented...) "url"
					// property.
					setImmediate(next);
					return;
				}
				session.linkList = session.linkList.concat(item.symlink || []);
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
				setImmediate(next, null, [{
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

				context.fileList = [];
				context.workDir = item.url;
				context.destDir = destination;

				async.series([
					_walkFolder.bind(null, context, ".", item.url),
					_removeExcludedFiles.bind(self, context),
					_prefix.bind(self, context)
				], function _out(err) {
					log.verbose("generate#_processFolder#_out()", "fileList.length:", context.fileList.length);
					log.silly("generate#_processFolder#_out()", "fileList:", context.fileList);
					next(err, context.fileList);
				});
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
				setImmediate(next);
				return;
			}

			if (url.substr(0, 4) !== 'http') {
				setImmediate(next, new Error("Source '" + url + "' does not exists"));
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
			setImmediate(next, err);
		}
	}

	function _unzipFile(context, next) {
		log.silly("Generator#_unzipFile()", context.archive, "=>", context.workDir);
		extract(context.archive, {
				dir: context.workDir
			},
			function(err) {
				if (err) {
					return setImmediate(next, err);
				}
				_walkFolder(context, ".", context.workDir, next);
			}
		);
	}

	function _walkFolder(context, dirName, dirPath, next) {
		//log.silly("generate#_walkFolder()", "arguments:", arguments);
		async.waterfall([
			fs.readdir.bind(null, dirPath),
			function(fileNames, next) {
				//log.silly("generate#_walkFolder()", "fileNames:", fileNames, "dirPath:", dirPath);
				async.forEach(fileNames, function(fileName, next) {
					//log.silly("generate#_walkFolder()", "fileName:", fileName, "dirPath:", dirPath);
					var filePath = path.join(dirPath, fileName);
					async.waterfall([
						fs.stat.bind(null, filePath),
						function(stat, next) {
							var name = generator.normalizePath(path.join(dirName, fileName));
							if (stat.isFile()) {
								context.fileList.push({name: name, path: filePath});
								setImmediate(next);
							} else {
								_walkFolder(context, name, filePath, next);
							}
						}
					], next);
				}, next);
			}
		], function(err) {
			if (err) {
				return next(err);
			}
			log.silly("generate#_walkFolder()", "fileList.length:", context.fileList.length);
			//log.silly("generate#_walkFolder()", "fileList:", context.fileList);
			next();
		});
	}

	function _removeExcludedFiles(context, next) {
		var fileList = context.fileList;
		log.silly("Generator#_removeExcludedFiles()", "input fileList:", fileList);

		var excluded = context.item.excluded;
		log.verbose("Generator#_removeExcludedFiles()", "excluded:", excluded);

		fileList = fileList.filter(function(file) {
			var skip = false;
			if (!skip && Array.isArray(excluded)) {
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
		setImmediate(next);
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
		setImmediate(next);
	}

	function _substitute(session, next) {
		//log.silly("Generator#_substitute()", "arguments:", arguments);
		var substits = session.substitutions || [];
		log.verbose("_substitute()", "input fileList.length:", session.fileList.length);
		log.verbose("_substitute()", "substits:", substits);

		async.forEachSeries(substits, function(substit, next) {
			log.silly("_substitute()", "applying substit:", substit);
			var regexp = new RegExp(substit.fileRegexp);
			var fileList = session.fileList.filter(function(file) {
				log.silly("_substitute()", regexp, "matching? file.name:", file.name);
				return regexp.test(file.name);
			});
			// Thanks to js ref-count system, elements of
			// the subset fileList are also elements of
			// the original input fileList
			async.forEach(fileList, function(file, next) {
				log.verbose("_substitute()", "matched file:", file);
				async.series([
					function(next) {
						if (substit.json) {
							log.verbose("_substitute()", "applying json substitutions to:", file);
							_applyJsonSubstitutions(file, substit.json, substit.add, next);
						} else {
							setImmediate(next);
						}
					},
					function(next) {
						if (substit.vars) {
							log.verbose("_substitute()", "Applying VARS substitutions to", file);
							_applyVarsSubstitutions(file, substit.vars, next);
						} else {
							setImmediate(next);
						}
					},
					function(next) {
						if (substit.regexp) {
							log.verbose("_substitute()", "Applying Regexp substitutions to", file);
							_applyRegexpSubstitutions(file, substit.regexp, next);
						} else {
							setImmediate(next);
						}
					}
				], function(err) {
					next(err);
				});
			}, next);
		}, next);
		
		function _applyJsonSubstitutions(file, json, add, next) {
			log.verbose("_applyJsonSubstitutions()", "substituting json:", json, "in", file);
			async.waterfall([
				fs.readFile.bind(null, file.path, {encoding: 'utf8'}),
				function(content, next) {
					log.silly("_applyJsonSubstitutions()", "loaded JSON string:", content);
					content = JSON.parse(content);
					log.silly("_applyJsonSubstitutions()", "content:", content);
					var modified, keys = Object.keys(json);
					keys.forEach(function(key) {
						if (content.hasOwnProperty(key) || (add && add[key])) {
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
						setImmediate(next);
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
					fs.writeFile(file.path, content, {encoding: 'utf8'}, next);
				}
			], next);
		}

		function _applyRegexpSubstitutions(file, changes, next) {
			log.verbose("_applyRegexpSubstitutions()", "substituting word in", file);
			async.waterfall([
				fs.readFile.bind(null, file.path, {encoding: 'utf-8'}),
				function(content, next) {
					Object.keys(changes).forEach(function(key) {
						var value = changes[key];
						log.silly("_applyRegexpSubstitutions()", "regexp=" + key + " -> value=" + value);
						var regExp = new RegExp(key, "g");
						content = content.replace(regExp, value);
					});
					file.path = temp.path({dir: session.tmpDir, prefix: "subst.regexp."});
					fs.writeFile(file.path, content, {encoding: 'utf8'}, next);
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
			setImmediate(next);
		}
	}
	function _symlink(session, next) {
		var dstDir = session.destination,
			linkList = session.linkList;
		log.verbose("generate#_symlink()", "dstDir:", dstDir, "linkList.length:", linkList.length);
		async.forEachSeries(linkList, __makeSymlink, next);

		function __makeSymlink(symlinkObj, next) {
			if (dstDir) {
				var symNames = Object.keys(symlinkObj);
				async.forEachSeries(symNames, function(name, next) {
					var link = symlinkObj[name];
					if (!link) {
						return setImmediate(next);
					}
					try {
						var stat = fs.lstatSync(link);
						var symlinkType;
						if (stat.isDirectory()) {
							symlinkType = 'dir';
						} else if (stat.isFile()) {
							symlinkType = 'file';
						}
						if (!symlinkType) {
							return setImmediate(next, new Error("Cannot recognize the file type of " + link));
						}
					} catch (err) {
						if (err.code === "ENOENT") {
							setImmediate(next, new Error("Cannot make a symlink for " + link));
						} else {
							setImmediate(next, err);
						}
						return;
					}
					var dst = path.join(dstDir, name);
					if (path.basename(path.dirname(path.resolve(dst))) !== path.basename(path.resolve(dstDir))) {
						mkdirp.sync(path.dirname(path.resolve(dst)));
					}
					log.silly('generate#_symlink()', dst, "<-", link);
					async.series([

						function(next) {
							if (fs.existsSync(dst)) {
							    setImmediate(next);
							} else {
								async.series([
									fs.symlink.bind(null, link, dst, symlinkType)
								], function(err, result) {
									if (err && err.code === 'EPERM') {
										return copyDir(link, dstDir, next);
                                    }
							        setImmediate(next);
								});
							}
						}
					], next);
				}, next);
			} else {
				setImmediate(next);
			}
		}
	}
}());
