/* global describe,it */
var //path = require("path"),
    url = require("url"),
    //http = require("http"),
    temp = require("temp"),
    //shell = require("shelljs"),
    log = require('npmlog'),
    nopt = require('nopt'),
    should = require("should"),
    //request = require("request"),
    rimraf = require("rimraf"),
    util = require("util"),
    async = require("async");

var knownOpts = {
	"proxy": url,
	"level": ['silly', 'verbose', 'info', 'http', 'warn', 'error']
};
var shortHands = {
	"p": "--proxy",
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
			"id": "bootplate-nightly",
			"type": "template",
			"files": [
				{
					"url": "http://nightly.enyojs.com/latest/bootplate-latest.zip",
					"prefixToRemove": "bootplate",
					"excluded": [
						"bootplate/api"
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
						"bootplate/api"
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
						"bootplate/api"
					]
				}
			],
			"description": "Enyo bootplate 2.1.1"
		}
	]
};

describe("Testing generator", function() {

	badConfigs.forEach(function(config) {
		log.info("t1", "---- ");
		it("t1. should fail to instanciate a code generator", function(done) {
			log.verbose("config:" + util.inspect(config));
			generator.create(config, function(err, gen) {
				log.verbose("t1", "err:", err);
				should.exist(err);
				should.not.exist(gen);
				done();
			});
		});
	});

	log.info("t2", "---- ");
	it("t2. should instanciate a code generator (real-world config)", function(done) {
		generator.create(configOk, function(err, gen) {
			should.not.exist(err);
			should.exist(gen);
			done();
		});
	});

	log.info("t3", "---- ");
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
				log.info("t3", "filelist:", filelist);
				// XXX each item in filelist should
				// XXX include only files & be
				// XXX relative to the desination dir.
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	log.info("t4", "---- ");
	it("t4. should generate a config based on one folder", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: __dirname
				}]
			}]}),
			function(gen, next) {
				log.silly("t4-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t4-2", "arguments", arguments);
				log.info("t4", "filelist:", filelist);
				should.exist(filelist);
				filelist.should.be.an.instanceOf(Array);
				filelist.length.should.equal(3);
				// XXX each item in filelist should
				// XXX include only files & be
				// XXX relative to the desination dir.
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});

	log.info("t5", "---- ");
	it("t5. should generate a config based on one folder (with exclusion)", function(done) {
		var ctx = {};
		async.waterfall([
			generator.create.bind(generator, {sources: [{
				id: "my-id",
				type: "my-type",
				description: "my-description",
				files: [{
					url: __dirname,
					filterOut: "\\.js$"
				}]
			}]}),
			function(gen, next) {
				log.silly("t5-1", "arguments", arguments);
				ctx.gen = gen;
				ctx.tmpDir = temp.path({prefix: "generator.spec."});
				ctx.gen.generate(["my-id"], null /*subst*/, ctx.tmpDir /*dest*/, null /*options*/, next);
			},
			function(filelist, next) {
				log.silly("t5-2", "arguments", arguments);
				log.info("t5", "filelist:", filelist);
				should.exist(filelist);
				filelist.should.be.an.instanceOf(Array);
				filelist.length.should.equal(3);
				// XXX each item in filelist should
				// XXX include only files & be
				// XXX relative to the desination dir.
				next();
			}
		], function(err) {
			should.not.exist(err);
			rimraf(ctx.tmpDir, done);
		});
	});
});
