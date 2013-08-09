/*jshint node: true, strict: false, globalstrict: false */

var shell = require("shelljs"),
    request = require('request'),
    fs = require("fs"),
    rimraf = require("rimraf"),
    path = require("path"),
    log = require('npmlog'),
    temp = require("temp"),
    async = require("async"),
    mkdirp = require("mkdirp"),
    unzip = require('unzip'),
    copyFile = require('./copyFile');

(function () {

	var generator = {};

	var NODE_V_0_8 = !!process.version.match('^v0.8');

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = generator;
	}

	var objectCounter = 0;

	function Generator(config, next) {
		this.config = config;
		log.level = config.level || 'http';
		this.objectId = objectCounter++;
		var sources = {};
		config.sources.forEach(function(source) {
			if ((typeof source.id === 'string') && 
			    (typeof source.type === 'string') && 
			    (typeof source.description === 'string') &&
			    (Array.isArray(source.files))) {
				sources[source.id] = source;
				log.verbose("Generator()", "loaded source:", source);
			} else {
				log.verbose("Generator()", "skipping incomplete source:", source);
			}
		});
		this.config.sources = sources;

		log.info("Generator()", "config:", this.config);
		next();
	}

	generator.Generator = Generator;

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
			next(null, outSources);
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
				next(new Error("'" + destination + "' already exists"));
				return;
			}

			async.series([
				async.forEachSeries.bind(generator, sources, _processSource.bind(generator)),
				_substitute.bind(generator, substitutions, destination)
			], function _notifyCaller(err) {
				if (err) {
					next(err);
					return;
				}

				// Return the list of extracted files (XXX: use async processing)
				var filelist = shell.find(destination);
				next(null, filelist);
			});

			function _processSource(source, next) {
				log.silly("generate#_processSource()", "processing source:", source);
				async.forEachSeries(source.files, _processFile.bind(generator), next);
			}

			function _processFile(source, next) {
				if ((path.extname(source.url).toLowerCase() === ".zip") ||
				    (path.extname(source.alternateUrl).toLowerCase() === ".zip")) {
					_processZipFile(source, next);
				} else {
					_processSimpleFile(source, next);
				}
			}

			function _processSimpleFile(item, next) {
				log.info("generate#_processSimpleFile()", "Processing " + item.url);
				var src = item.url,
				    dst = path.join(destination, item.installAs);
				log.verbose('generate#_processSimpleFile()', src + ' -> ' + dst);
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
				next();
				return;
			}

			if (url.substr(0, 4) !== 'http') {
				next(new Error("Source '" + url + "' does not exists"));
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
			next(err);
		}
	}

	function _unzipFile(context, next) {
		log.silly("Generator#_unzipFile()", context.archive, "=>", context.workDir);
		try {
			var extractor = unzip.Extract({ path: context.workDir });
			extractor.on('close', next);
			fs.createReadStream(context.archive).pipe(extractor);
		} catch(err) {
			next(err);
		}
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
		log.silly("generate#_prefix()", "item:", context.item);
		var src = context.item.prefixToRemove ? path.join(context.workDir, context.item.prefixToRemove) : context.workDir;
		var dst = context.item.prefixToAdd ? path.join(context.destDir, context.item.prefixToAdd) : context.destDir;
		log.verbose("generate#_prefix()", "src:", src, "-> dst:", dst);
		async.waterfall([
			function(next) {
				log.silly("generate#_prefix#mkdirp()", dst);
				mkdirp(dst, next);
			},
			function(data, next) {
				log.silly("generate#_prefix#fs.readdir()", src);
				fs.readdir(src, next);
			},
			_mv.bind(this)
		], next);

		function _mv(files, next) {
			log.silly("generate#_prefix#_mv()", "files:", files);
			async.forEach(files, function(file, next) {
				log.silly("generate#_prefix#_mv()", file + " -> " + dst);
				fs.rename(path.join(src, file), path.join(dst, file), next);
			}, next);
		}
	}

	function _substitute(substitutions, workDir, next) {
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

		next();

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
