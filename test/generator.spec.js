/* global describe,it */
var path = require("path"),
    fs = require("graceful-fs"),
    os = require("os"),
    url = require("url"),
    temp = require("temp"),
    log = require('npmlog'),
    nopt = require('nopt'),
    should = require("should"),
    rimraf = require("rimraf"),
    util = require("util"),
    async = require("async");

var extend = require('util')._extend;

var knownOpts = {
	"proxy": url,
	"app": path,
	"level": ['silly', 'verbose', 'info', 'http', 'warn', 'error']
};
var shortHands = {
	"p": "--proxy",
	"a": "--app",
	"l": "--level",
	"v": "--level verbose"
};
var opt = nopt(knownOpts, shortHands, process.argv, 2 /*drop 'node' & basename*/);
log.heading = 'generator.spec';
log.level = opt.level || 'error';
log.info("opt:", opt);

var generator = require("./../ares-generator.js");

var badConfigs = [
	undefined,
	[],
	{},
	{ foo: "bar" },
	{ sources: [ {} ] },
	{ sources: [ { _id: "my-id", type: "my-type", description: "my-description", files: [] } ] },
	{ sources: [ { id: "my-id", _type: "my-type", description: "my-description", files: [] } ] },
	{ sources: [ { id: "my-id", type: "my-type", _description: "my-description", files: [] } ] },
	{ sources: [ { id: "my-id", type: "my-type", description: "my-description", _files: [] } ] },
	{ sources: [
		{ id: "id1", type: "my-type", description: "my-description", files: [] },
		{ id: "id2", type: "my-type", description: "my-description", _files: [] }
	] },
	{ eof: null }
];

var configOk = {
	"proxyUrl": opt.proxy || process.env['http_proxy'],
	"sources": [
		{
			"id": "webos-bootplate-nightly",
			"type": "template",
			"description": "Enyo bootplate for webOS - Nightly",
			"files": [
				{
					"url": "http://nightly.enyojs.com/latest/bootplate-latest.zip",
					"prefixToRemove": "bootplate",
					"excluded": [
						"bootplate/api/",
						"bootplate/build/",
						"bootplate/deploy/",
						"bootplate/enyo/tools/"
					]
				},
				{
					"url": "http://enyojs.com/webos/webos-app-config.zip"
				}
			]
		}, {
			"id": "bootplate-nightly",
			"type": "template",
			"files": [
				{
					"url": "http://nightly.enyojs.com/latest/bootplate-latest.zip",
					"prefixToRemove": "bootplate",
					"excluded": [
						"bootplate/api/",
						"bootplate/build/",
						"bootplate/deploy/",
						"bootplate/enyo/tools/"
					]
				}
			],
			"description": "Enyo bootplate for webOS - Nightly"
		}, 
		{
			"id": "bootplate-2.2.0",
			"type": "template",
			"files": [
				{
					"url": "http://enyojs.com/archive/bootplate-2.2.0.zip",
					"prefixToRemove": "bootplate",
					"excluded": [
						"bootplate/api/",
						"bootplate/build/",
						"bootplate/deploy/",
						"bootplate/enyo/tools/"
					]
				}
			],
			"description": "Enyo bootplate 2.2.0"
		},
		{
			"id": "bootplate-2.1.1",
			"type": "template",
			"files": [
				{
					"url": "http://enyojs.com/archive/bootplate-2.1.1.zip",
					"prefixToRemove": "bootplate",
					"excluded": [
						"bootplate/api/",
						"bootplate/build/",
						"bootplate/deploy/",
						"bootplate/enyo/tools/"
					]
				}
			],
			"description": "Enyo bootplate 2.1.1"
		}
	]
};

function checkFileList(prefix, val, expected) {
	should.exist(val);
	val.should.be.an.instanceOf(Array);
	val.sort();
	expected.sort();
	log.verbose(prefix, "val.length:", val.length, "expected.length:", expected.length);
	val.forEach(function(f, i) {
		should.exist(f);
		f.should.be.a('string');
		f.should.equal(expected[i]);
	});
}

describe("Testing generator", function() {

	badConfigs.forEach(function(config, i) {
		it("t1."+ i + ". should fail to instanciate a code generator", function(done) {
			log.verbose("config:" + util.inspect(config));
			generator.create(config, function(err, gen) {
				log.verbose("t1."+ i + ".", "err:", err);
				should.exist(err);
				should.not.exist(gen);
				done();
			});
		});
	});

	it("t2.0. should instanciate a code generator (real-world config)", function(done) {
		generator.create(extend({}, configOk), function(err, gen) {
			should.not.exist(err);
			should.exist(gen);
			done();
		});
	});

	it("t2.1. should re-instanciate the same code generator (real-world config)", function(done) {
		generator.create(extend({}, configOk), function(err, gen) {
			should.not.exist(err);
			should.exist(gen);
			done();
		});
	});

	it("t3. should generate a config based on one file", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: __filename,
					installAs: "foo.js"
				}]
			}]}),
			function(gen, next) {
				log.silly("t3-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t3-2", "arguments", arguments);
				log.info("t3-2", "filelist:", filelist);
				checkFileList("t3-2", filelist, ['foo.js']);
				next();
			}
		], function(err) {
			log.silly("t3", "arguments", arguments);
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t4.0. should generate a config based on one folder (no exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: path.join(__dirname, 'data', 't4')
				}]
			}]}),
			function(gen, next) {
				log.silly("t4.0-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t4.0-2", "arguments", arguments);
				log.info("t4.0-2", "filelist:", filelist);
				checkFileList("t4.0-2", filelist, [ 'bar.txt', 'foo.js' ]);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t4.1. should generate a config based on one folder (no exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: path.join(__dirname, 'data', 't4'),
					excluded: []
				}]
			}]}),
			function(gen, next) {
				log.silly("t4.1-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t4.1-2", "arguments", arguments);
				log.info("t4.1-2", "filelist:", filelist);
				checkFileList("t4.1-2", filelist, [ 'bar.txt', 'foo.js' ]);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t4.2. should generate a config based on one folder (with non-empty exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: path.join(__dirname, 'data', 't4'),
					excluded: [
						"foo.js"
					]
				}]
			}]}),
			function(gen, next) {
				log.silly("t4.2-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t4.2-2", "arguments", arguments);
				log.info("t4.2-2", "filelist:", filelist);
				checkFileList("t4.2-2", filelist,[ 'bar.txt' ]);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t5.0. should generate a config based on one sub-folder (no exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: path.join(__dirname, 'data', 't5')
				}]
			}]}),
			function(gen, next) {
				log.silly("t5.0-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t5.0-2", "arguments", arguments);
				log.info("t5.0-2", "filelist:", filelist);
				checkFileList("t5.0-2", filelist, ['dir/bar.txt', 'dir/foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t5.1. should generate a config based on one sub-folder (no exclusion, prefix removed)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: path.join(__dirname, 'data', 't5'),
					prefixToRemove: "dir"
				}]
			}]}),
			function(gen, next) {
				log.silly("t5.1-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t5.1-2", "arguments", arguments);
				log.info("t5.1-2", "filelist:", filelist);
				should.exist(filelist);
				checkFileList("t5.1-2", filelist, ['bar.txt', 'foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t5.2. should generate a config based on one sub-folder (no exclusion, prefix added)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: path.join(__dirname, 'data', 't5'),
					prefixToAdd: "superdir"
				}]
			}]}),
			function(gen, next) {
				log.silly("t5.2-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t5.2-2", "arguments", arguments);
				log.info("t5.2-2", "filelist:", filelist);
				checkFileList("t5.2-2", filelist, ['superdir/dir/bar.txt', 'superdir/dir/foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t6. should generate a project based on a single file, plus a folder (no exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					"url": path.join(__dirname, '..', 'README.md'),
					"installAs": "README.md"
				},{
					url: path.join(__dirname, 'data', 't5')
				}]
			}]}),
			function(gen, next) {
				log.silly("t6-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t6-2", "arguments", arguments);
				log.info("t6-2", "filelist:", filelist);
				checkFileList("t6-2", filelist, ['README.md', 'dir/bar.txt', 'dir/foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t7.0. should generate a project based on a single zip-file (no exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					"url": path.join(__dirname, 'data', 't5.zip')
				}]
			}]}),
			function(gen, next) {
				log.silly("t7.0-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t7.0-2", "arguments", arguments);
				log.info("t7.0-2", "filelist:", filelist);
				checkFileList("t7.0-2", filelist, ['dir/bar.txt', 'dir/foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t7.1. should generate a project based on a single zip-file (no exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					"url": path.join(__dirname, 'data', 't4.zip')
				}, {
					"url": path.join(__dirname, 'data', 't5.zip')
				}]
			}]}),
			function(gen, next) {
				log.silly("t7.1-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t7.1-2", "arguments", arguments);
				log.info("t7.1-2", "filelist:", filelist);
				checkFileList("t7.1-2", filelist, ['bar.txt', 'foo.js', 'dir/bar.txt', 'dir/foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t7.2. should generate a project based on two zip-files (no exclusion, prefixes)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					"url": path.join(__dirname, 'data', 't5.zip'),
					"prefixToRemove": "dir"
				}, {
					"url": path.join(__dirname, 'data', 't4.zip'),
					"prefixToAdd": "dir1"
				}]
			}]}),
			function(gen, next) {
				log.silly("t7.2-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t7.2-2", "arguments", arguments);
				log.info("t7.2-2", "filelist:", filelist);
				checkFileList("t7.2-2", filelist, ['bar.txt', 'foo.js', 'dir1/bar.txt', 'dir1/foo.js']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t7.3. should generate a project based one folder & one file (exclusion, prefixes)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					"url": path.join(__dirname, 'data', 't7'),
					"prefixToRemove": "dir1",
					"prefixToAdd": "dir0"
				}, {
					"url": path.join(__dirname, '..', 'README.md'),
					"installAs": "dir3/README.md"
				}]
			}]}),
			function(gen, next) {
				log.silly("t7.3-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t7.3-2", "arguments", arguments);
				log.info("t7.3-2", "filelist:", filelist);
				checkFileList("t7.3-2", filelist, ['dir0/dir2/bar.txt', 'dir0/dir2/foo.js', 'dir3/README.md']);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t8.0. should generate a project with webos-app-config.zip (webos substitutions)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					"url": path.join(__dirname, 'data', 't8', 'webos-app-config.zip')
				}]
			}]}),
			function(gen, next) {
				log.silly("t8.0-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], [{
					fileRegexp: "appinfo.json",
					"json": {"vendor": "Your Company", "title": "Your App"}
				}], ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t8.0-2", "arguments", arguments);
				log.info("t8.0-2", "filelist:", filelist);
				checkFileList("t8.0-2", filelist, ['appinfo.json',
								   'debug.html',
								   'framework_config.json',
								   'index.html']);
				var appInfo = JSON.parse(fs.readFileSync(path.join(ctx.tmpDir, 'appinfo.json')));
				log.info("t8.0-2", "appinfo.json:", appInfo);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	var appDir = opt.app || path.join(os.tmpDir(), "bootplate");

	if (fs.existsSync(appDir)) {

	it("t9.0. should generate a project folder tree based on a local copy of bootplate 2.2  '" + appDir + "'", function(done) {
		this.timeout(8000);
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				"id": "my-app-id",
				"type": "template",
				"description": "Local App",
				"files": [{
					"url": appDir,
					"excluded": [
						"api",
						".npmignore"
					]
				}]
			}]}),
			function(gen, next) {
				log.silly("t9.0-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-app-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				//log.silly("t9.0-2", "arguments", arguments);
				log.info("t9.0-2", "filelist.length:", filelist.length);
				log.info("t9.0-2", "app path:", ctx.tmpDir);
				checkFileList("t9.0-2", filelist, JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'bootplate-2.2.0-filelist.json'))));
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	it("t9.1. should generate a project file map based on a local copy of bootplate 2.2 '" + appDir + "'", function(done) {
		this.timeout(8000);
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				"id": "my-app-id",
				"type": "template",
				"description": "Local App",
				"files": [{
					"url": appDir,
					"excluded": [
						"api",
						".npmignore"
					]
				}]
			}]}),
			function(gen, next) {
				log.silly("t9.1-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.gen.generate(["my-app-id"], null /*subst*/, undefined /*dest*/, null /*options*/, next);
			},
			function(filemap, dir, next) {
				//log.silly("t9.1-2", "arguments", arguments);
				log.info("t9.1-2", "filemap.length:", filemap.length);
				var filelist = filemap.map(function(file) {
					return file.name;
				});
				checkFileList("t9.1-2", filelist, JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'bootplate-2.2.0-filelist.json'))));
				next(null, dir);
			},
			rimraf.bind(this)
		], function(err) {
			should.not.exist(err);
			done();
		});
	});

	} else {
		log.info("t9.0", "skipping test, no bootplate-2.2 found at folder '" + appDir + "'");
	}

	it("t10.0. should generate a config based on real-world bootplate-webos", function(done) {
		this.timeout(30000);
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, extend({}, configOk)),
			function(gen, next) {
				log.silly("t10.0-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["webos-bootplate-nightly"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t10.0-2", "arguments", arguments);
				log.info("t10.0-2", "filelist:", filelist);
				should.exist(filelist);
				filelist.should.be.an.instanceOf(Array);
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});
});
