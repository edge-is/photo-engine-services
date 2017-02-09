var bunyan = require('bunyan');

module.exports = function logger(config, type, verbose){


  var _location = config.log[type];

  var logConfig = {
    name: config.name,
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
    logConfig.streams.push(debugStream);
  }

  return bunyan.createLogger(logConfig);

}
