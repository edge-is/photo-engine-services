const bunyan = require('bunyan');
const RotatingFileStream = require('bunyan-rotating-file-stream');

module.exports = function logger(config, type, verbose){

  var _location = config.log[type];
  var logLevel = (verbose) ? 'debug' : 'info';
  var stream =  process.stdout;

  if (!verbose){
    stream = new RotatingFileStream({
      level: 'info',
      path: _location.info,
      period: '1d',
      totalFiles: 10,        // keep 10 back copies
      rotateExisting: true,  // Give ourselves a clean file when we start up, based on period
      threshold: '100m',      // Rotate log files larger than 10 megabytes
      totalSize: '500m',      // Don't keep more than 20mb of archived log files
      gzip: true             // Compress the archive log files to save space
    });

  }


  var logConfig = {
    name: 'photo-engine-services',
    level : 30,
    stream: stream
  };

  if (verbose){
    console.log('Verbose logging on')
  }

  var log= bunyan.createLogger(logConfig);

  log.warning = log.warn;

  return log;

}
