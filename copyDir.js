/*jshint node: true, strict: false, globalstrict: false */

module.exports = copySrcToDst;

var shelljs = require('shelljs'),
	Rsync = require('rsync');

function copySrcToDst(src, dst, next) {
    try {
        if (process.platform === 'win32') {
            try {
                shelljs.cp('-rf', src, dst);
                setImmediate(next);
            } catch(err) {
                setImmediate(next, err);
            }
        } else {
            var rsync = new Rsync();
            rsync.flags({
                    'a': true,
                    'r': true,
                    'L': true,
                    'v': false
                });
            //TODO: rsync npm module can't handle the path including blank.
            //      So, the path should be surrounded with double quotes.
            rsync.source('"'+src+'"')
                .destination('"'+dst+'"');
            rsync.execute(next);
        }
    } catch(err) {
        setImmediate(next, err);
    }
}
