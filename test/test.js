/* globals require, Buffer, process */

var nodezip = require('node-zip'),
    request = require('request'),
    util = require('util'),
    path = require('path'),
    fs = require('fs'),
    log = require('npmlog'),
    mkdirp = require('mkdirp'),
    async = require('async');

log.level ='silly';

var url = "http://enyojs.com/archive/bootplate-2.2.0.zip",
    archive = path.basename(url);

async.series([
	// Fetch the zip file for the test
	function(next) {
		fs.exists(archive, function(exists) {
			if (exists === true) {
				next();
			} else {
				request({
					url: url,
					proxy: process.env['https_proxy']
				}).pipe(
					fs.createWriteStream(archive).on('close', next)
				);
			}
		});
	},
	function(next) {
		async.waterfall([
			fs.readFile.bind(fs, archive, 'binary'),
			function(arBuf, next) {
				log.verbose("arBuf.length:", arBuf.length);
				var ar;
				try {
					ar = new nodezip(arBuf, { base64: false, checkCRC32: false });
				} catch(err) {
					next(err);
				}
				log.verbose('ar:', util.inspect(Object.keys(ar)));
				log.verbose('typeof ar.root:', typeof ar.root);
				log.verbose('ar.root:', ar.root);
				async.forEachSeries(Object.keys(ar.files), function(fileKey, next) {
					var file = ar.files[fileKey], encoding;
					log.silly("file.name:", file.name);
					log.silly("file.options:", file.options);
					async.series([
						mkdirp.bind(null, path.dirname(file.name)),
						function(next) {
							if (file.options.dir) {
								log.silly("mkdir", file.name);
								fs.mkdir(file.name, next);
							} else {
								log.silly("write", file.name);
								if (file.options.binary) {
									encoding = 'binary';
								} else if (file.options.base64) {
									encoding = 'base64';
								} else {
									encoding = 'utf8';
								}
								var buf = new Buffer(file.data, encoding);
								fs.writeFile(file.name, buf, next);
							}
						}
					], next);
				}, next);
			}
		], next);
	}
], function(err) {
	if (err) {
		log.error(err);
	} else {
		log.info('ok');
	}
});

