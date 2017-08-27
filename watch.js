
const u = require('./lib/utils.js');

const async = require('async');
const argv = require('yargs').argv;

const logger = require('./lib/logger.js');
const path = require('path');
const configLoader = require('./lib/config-loader.js');
const Status = require('./lib/status.js');
const redis = require('redis');
const Queue = require('bull');

var FindJS = require('find.js');

var configFile = argv.c || 'config.yml';
var config = configLoader(configFile);
var log = logger(config, 'watch', argv.v);

var redisClient = redis.createClient({
   host : config.redis.server,
   port : config.redis.port
 });

var status = new Status(config.status, redisClient);
var concurrency = 10;
if (argv.concurrency){
  concurrency = parseInt(argv.concurrency) || concurrency;
}

if (!argv.v){
  console.log('Starting.. logging to file, -v for verbose');
}
var skipStatus = argv.s || false;


if (argv.h){
  return console.log(`
    -v  verbose
    -n  dry run
    -h  help message
    -c  <yaml file>
    --concurrency <numb>
    `)
}
var queueRedisConfig = {
  redis: {
    port: config.redis.port,
    host: config.redis.server
  }
};

var queue = new Queue(config.queue, queueRedisConfig);

var watchPipeline = {
  checkStatus : function (object, callback){

    //var fileID = object.fileID  + Math.random();
    log.info(`Checking status on ${object._fileID.input}`);
    status.get(object.fileID, function (err, res){
      if (err) return callback(err);
      if (res === null){
        object.existsInStatus = false;
        // File does not exist in status table-
        object.changed = true;

        return callback(null, object);
      }

      log.info(`Alread exists, checking status and timestamp`);
      status.hasChanged(object.fileID, object.stats, function (err,  hasChanged){
        if (err) {
          log.error('hasChanged', err);
          return callback(err);
        }
        log.info(`${object.fileID}:${object.path} has changed:${hasChanged}`);

        if (hasChanged) return callback(null, object);


        return callback(`${object.fileID}:${object.path} has not changed skipping`);
      })

    })

  },
  addToQueue : function (object, callback){
    object.status = "new";


    queue.add(object).then(function (stats){

      log.info(`Adding to queue:${stats.queue.name} with ID: ${stats.id}`);
      status.new(object.fileID, object.path, stats.queue.name, stats.id, object.stats, function (err, res){
        if (err) {
          log.error(`Error updating status of object ${object.fileID}`, err);
          return callback(err);
        }
        callback(null, object);
      });
    })


  }
};




// FIXME: delete this : concurrency
//
concurrency = 1;
async.forEachLimit(config.servers, 1, function (server, next){
  log.info('Starting' , server.source.folder);


  scanForFiles(server.source.folder, function (err, res){
    if (err) return next(err);

    log.info(`Found files ${res.files.length}, starting processing files with concurrency:${concurrency}`);

    async.forEachLimit(res.files, concurrency, function eachFile(file, next){
      file._serverConfig = server;
      file.file = {
        location : 'filesystem',
        path : file.path
      };
      return processFile(file, next);
    }, function done(){
      log.info(`Done processing ${server.source.folder} files: ${res.files.length} will start again in XX seconds??`)
    });
  });
});


// Helper functions.
function processFile(file, callback){
  file._fileID = createFileID(file);
  file.fileID = file._fileID.id;
  file.changed= false;
  async.waterfall([
    async.apply(watchPipeline.checkStatus, file),
    watchPipeline.addToQueue
  ], function waterfallDone(err){

    if (err) log.info(err);

    log.info(`Pipeline done for id:${file.fileID}:${file.path}`);

    file = null;
    return callback(null);
  })
}
function scanForFiles(directory, callback){
  var find = new FindJS(directory);
  return find.start(callback);
}
function createFileID(file){
  var input = file.path;
  return {
    input : input,
    id : u.md5(input)
  };
}
