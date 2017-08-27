'use strict'
const argv = require('yargs').argv;
const path = require('path');
const configLoader = require('./lib/config-loader.js');
const Watch = require('./lib/watch.js');
const Worker = require('./lib/worker.js');
const type = argv.type;
const configDirectory = argv.c || '.';
const parseD = require('parse-duration');
const configFile = path.join(configDirectory, 'config.yml');
const config = configLoader(configFile);


if (!argv.v){
  console.log('Starting.. logging to file, -v for verbose');
  process.env.VIPS_WARNING=0;
}

if (type === 'watch'){

  var watch = new Watch({
    config : config,
    verbose : argv.v || false,
    force : argv.f || false,
    interval : parseD(config.interval)
  });
  // Start the watcher
  return watch.start();
}


if (type === 'worker'){

  var worker = new Worker({
    config : config,
    verbose : argv.v || false,
    force : argv.f || false,
    interval : parseD(config.interval)
  });
  // Start the watcher
  return worker.start();
}

function _help(){
  console.log(`
    usage ${argv.$0} [-v] --type [worker|watch] [-c configDirectory]

    watch: Will scan directory for changes based in interval in configfile
    `);
}

_help();
