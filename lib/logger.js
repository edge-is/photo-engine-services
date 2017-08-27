var bunyan = require('bunyan');

module.exports = function logger(config, type, verbose){


  var _location = config.log[type];

  var logConfig = {
    name: 'photo-engine-services',
    level : 30,
    streams: [

      {
        level: 'info',
        path: _location.info            // log INFO and above to stdout
      },
      {
        level: 'error',
        path: _location.error  // log ERROR and above to a file
      }
    ]
  };

  var debugStream = {
    level : 'debug',
    stream : process.stdout
  };

  if (verbose){
    console.log('Verbose logging on')
    logConfig.streams.push(debugStream);
  }

  var log= bunyan.createLogger(logConfig);

  log.warning = log.warn;

  return log;

}
