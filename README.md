ares-generator
==============

Node.js module shared by webOS SDK & Ares IDE to generate new projects
& manage  projects options.  This module  is not meant to  be used any
other way than mounted as a Git sub-module in an NPM-hierarchy.

Contribute
----------

Before forming  a GitHub  Pull-Request (PR),  please run  the prepared
jshint command as pull-request with jshint errors will be rejected.

```bash
npm test
```

Unit test suite:

First download & unpack bootplate-2.2 under `/tmp` (or the OS equivalent on Windows, see below on how to get the proper location for your OS)

```bash
curl http://enyojs.com/archive/bootplate-2.2.0.zip > /tmp/bootplate-2.2.0.zip
cd /tmp
unzip bootplate-2.2.0.zip
```

* Run the full test suite using default at default reporting level (error):
  ```bash
  node_modules/.bin/mocha test/generator.spec.js
  ```
* Run the full test suite using default at info level (will give you the location where to put bootplate-2.2 for your OS):
  ```bash
  node node_modules/.bin/mocha test/generator.spec.js --level info
  ```
* Run the full test suite using Node.js 0.8.25/x86 at silly level:
  ```bash
  node-0.8.25-x86 node_modules/.bin/mocha test/generator.spec.js --level silly
  ```
* Run a single test `t9.1` using Node.js 0.8.25/x86 at verbose level:
  ```bash
  node-0.8.25-x86 node_modules/.bin/mocha --grep t9.1 test/generator.spec.js --level verbose
  ```
* Run tests matching `t5.*` at default reporting level (error):
  ```bash
  node_modules/.bin/mocha --grep t5. test/generator.spec.js
  ```

Example output:

```
$   node_modules/.bin/mocha --grep t5. test/generator.spec.js


  Testing generator
    ✓ t5.0. should generate a config based on one sub-folder (no exclusion) 
    ✓ t5.1. should generate a config based on one sub-folder (no exclusion, prefix removed) 
    ✓ t5.2. should generate a config based on one sub-folder (no exclusion, prefix added) 


  ✔ 3 tests complete (44 ms)

```
