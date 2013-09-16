/*jshint node: true, strict: false, globalstrict: false */

var shell = require("shelljs"),
    util = require('util'),
    request = require('request'),
    fs = require("fs"),
    rimraf = require("rimraf"),
    path = require("path"),
    log = require('npmlog'),
    temp = require("temp"),
    async = require("async"),
    mkdirp = require("mkdirp"),
    nodezip = require('node-zip'),
    cpr = require('cpr'),
    copyFile = require('./copyFile');

(function () {

	var generator = {};

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

	var dotFiles = new RegExp("(^|/|\\\\)\\.");

	function Generator(config, next) {
		if (!isObject(config)) {
			setImmediate(next, new Error("Invalid configuration:" + config));
			return;
		}
		if (!isArray(config.sources)) {
			setImmediate(next, new Error("Invalid sources:" + config.sources));
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
			setImmediate(next, null, outSources);
		},

		generate: function(sourceIds, substitutions, destination, options, next) {
			log.info("generate()", "sourceIds:", sourceIds);
			var generator = this;
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
						var source = generator.config.sources[sourceId];
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
				return generator.config.sources[sourceId];
			});
			log.silly("generate()", "sources:", sources);

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
				async.forEachSeries.bind(generator, sources, _processSource.bind(generator)),
				_substitute.bind(generator, substitutions, destination)
			], function _notifyCaller(err) {
				if (err) {
					setImmediate(next, err);
					return;
				}

				// Return the list of extracted files (XXX: use async processing)
				// XXX each item in filelist should
				// XXX include only files & be
				// XXX relative to the desination dir.
				var filelist = shell.find(destination);
				setImmediate(next, null, filelist);
			});

			function _processSource(source, next) {
				log.silly("generate#_processSource()", "processing source:", source);
				async.forEachSeries(source.files, _processSourceItem.bind(generator), next);
			}

			function _processSourceItem(item, next) {
				if ((path.extname(item.url).toLowerCase() === ".zip") ||
				    (path.extname(item.alternateUrl).toLowerCase() === ".zip")) {
					_processZipFile(item, next);
				} else {
					fs.stat(item.url, function(err, stats) {
						if (err) {
							setImmediate(next, err);
						} else if (stats.isDirectory()) {
							_processFolder(item, next);
						} else if (stats.isFile()){
							_processFile(item, next);
						} else {
							setImmediate(next, new Error("Don't know how to handle '" + item.url + "'"));
						}
					});
				}
			}

			function _processFile(item, next) {
				log.info("generate#_processFile()", "Processing " + item.url);
				var src = item.url,
				    dst = path.join(destination, item.installAs);
				log.verbose('generate#_processFile()', src + ' -> ' + dst);
				async.series([
					mkdirp.bind(generator, path.dirname(dst)),
					copyFile.bind(generator, src, dst)
				], next);
			}

			function _processZipFile(item, next) {
				log.info("generate#_processZipFile()", "Processing " + item.url);
				var context = {
					item: item
				};
				temp.mkdir({
					prefix: 'com.enyojs.ares.generator',
					suffix: ".d"
				}, (function(err, tmpDir) {
					if (err) {
						setImmediate(next, err);
						return;
					}
					// all those dirs will be
					// cleaned when `tmpDir` will
					// go out of scope.
					context.archive = path.join(tmpDir, "archive");
					context.workDir = path.join(tmpDir, "work");
					context.destDir = destination;

					async.series([
						_fetchFile.bind(generator, context),
						fs.mkdir.bind(this, context.workDir),
						_unzipFile.bind(generator, context),
						_removeExcludedFiles.bind(generator, context),
						_prefix.bind(generator, context),
						rimraf.bind(this, tmpDir) // otherwise cleaned-up at process exit
					], next);
				}));
			}

			function _processFolder(item, next) {
				log.info("generate#_processFolder()", "Processing " + item.url);
				var context = {
					item: item
				};

				context.workDir = item.url;
				context.destDir = destination;

				async.series([
					_removeExcludedFiles.bind(generator, context),
					_prefix.bind(generator, context)
				], next);
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
					setImmediate(next, err);
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
						}
					], next);
				}, next);
			}
		], next);
	}

	function _removeExcludedFiles(context, next) {
		log.silly("Generator#_removeExcludedFiles()");
		async.forEach(context.item.excluded || [], function(excluded, next) {
			var f = path.join(context.workDir, excluded);
			log.silly("Generator#_removeExcludedFiles()", "rm -rf", f);
			rimraf(f, next);
		}, next);
        }

	function _prefix(context, next) {
		log.silly("Generator#_prefix()", "item:", context.item);
		var src = context.item.prefixToRemove ? path.join(context.workDir, context.item.prefixToRemove) : context.workDir;
		var dst = context.item.prefixToAdd ? path.join(context.destDir, context.item.prefixToAdd) : context.destDir;
		log.verbose("Generator#_prefix()", "src:", src, "-> dst:", dst);
		async.waterfall([
			function(next) {
				log.silly("Generator#_prefix#mkdirp()", dst);
				mkdirp(dst, next);
			},
			function(data, next) {
				log.silly("Generator#_prefix#cpr()", src, "->", dst);
				cpr(src, dst, {
					deleteFirst: false,
					overwrite: true,
					filter: _filter
				}, next);
			}
		], function(errs, filelist) {
			//log.silly("Generator#_prefix()", "arguments:", arguments);
			if (isArray(errs) && errs.length > 0) {
				errs.forEach(function(err) {
					log.warn("Generator#_prefix()", "err:", err.toString());
				});
				setImmediate(next, new Error("Unable to cp -R ... -> " + dst));
			} else if (errs) {
				log.warn("Generator#_prefix#()", "errs:", errs.toString());
				setImmediate(next, errs);
			} else {
				setImmediate(next, null, undefined /*filelist*/ /*TODO: use this list to go async*/ );
			}
		});
	}

	function _filter(file) {
		return !dotFiles.test(file);
	}

	function _substitute(substitutions, workDir, next) {
		//log.silly("Generator#_prefix()", "arguments:", arguments);
                // TODO: move to asynchronous processing
		log.verbose("_substitute()", "performing substitutions");

		// Apply the substitutions
		if (substitutions) {
			shell.ls('-R', workDir).forEach(function(file) {

				substitutions.forEach(function(substit) {
					var regexp = new RegExp(substit.fileRegexp);
					if (regexp.test(file)) {
						log.verbose("_substitute()", "substit:", substit, "on file:", file);
						var filename = path.join(workDir, file);
						if (substit.json) {
							log.verbose("_substitute()", "Applying JSON substitutions to: " + file);
							applyJsonSubstitutions(filename, substit.json);
						}
						if (substit.sed) {
							log.verbose("_substitute()", "Applying SED substitutions to: " + file);
							applySedSubstitutions(filename, substit.sed);
						}
						if (substit.vars) {
							log.verbose("_substitute()", "Applying VARS substitutions to: " + file);
							applyVarsSubstitutions(filename, substit.vars);
						}
					}
				});
			});
		}

		setImmediate(next);

		function applyJsonSubstitutions(filename, values) {
			// TODO: move to asynchronous processing
			var modified = false;
			var content = fs.readFileSync(filename);
			content = JSON.parse(content);
			var keys = Object.keys(values);
			keys.forEach(function(key) {
				if (content.hasOwnProperty(key)) {
					content[key] = values[key];
					modified = true;
				}
			});
			if (modified) {
				var newContent = JSON.stringify(content, null, 2);
				fs.writeFileSync(filename, newContent);         // TODO: move to asynchronous processing
			}
		}
		
		function applySedSubstitutions(filename, changes) {
			// TODO: move to asynchronous processing
			changes.forEach(function(change) {
				shell.sed('-i', change.search, change.replace, filename);
			});
		}
		
		function applyVarsSubstitutions(filename, changes) {
			// TODO: move to asynchronous processing
			log.verbose("applyVarsSubstitutions()", "substituting variables in '" + filename + "'");
			var content = fs.readFileSync(filename, "utf8" /*force String return*/);
			Object.keys(changes).forEach(function(key) {
				var value = changes[key];
				log.silly("applyVarsSubstitutions()", "key=" + key + " -> value=" + value);
				content = content.replace("${" + key + "}", value);
			});
			fs.writeFileSync(filename, content, "utf8");
		}
	}

}());
