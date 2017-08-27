'use strict'
const u = require('./utils.js');
const async = require('async');
const argv = require('yargs').argv;
const logger = require('./logger.js');
const path = require('path');
const Status = require('./status.js');
const redis = require('redis');
const Queue = require('bull');

var FindJS = require('find.js');

const createPipeline = require('./pipelines/watch.js');


var Watch = function (settings){
  var self = this;

  self.concurrency = settings.concurrency || 1;

  self.interval = settings.interval || false;

  self.config = settings.config;

  self.verbose = settings.verbose;

  if (!self.config){
    return console.log('Config is not defined, exit');
  }

  self.log = logger(self.config, 'watch', self.verbose);

  self.redisClient = settings.redisClient || redis.createClient({
     host : self.config.redis.server,
     port : self.config.redis.port
  });

  self.status = new Status(self.config.status, self.redisClient);

  self.force = settings.force || false;

  var queueRedisConfig = {
    redis: {
      port: self.config.redis.port,
      host: self.config.redis.server
    }
  };

  self.queue = new Queue(self.config.queue, queueRedisConfig);

  self.pipeline = createPipeline({ log : self.log, queue : self.queue, status : self.status });

  return self;
};

Watch.prototype.start = function () {
  var self = this;
  async.forEachLimit(self.config.servers, 1, function (server, next){
    self.log.info('Starting' , server.source.folder);


    scanForFiles(server.source.folder, function (err, res){
      if (err) return next(err);

      self.log.info(`Found files ${res.files.length}, starting processing files with concurrency:${self.concurrency}`);

      async.forEachLimit(res.files, self.concurrency, function eachFile(file, next){
        file._serverConfig = server;
        file.file = {
          location : 'filesystem',
          path : file.path
        };
        return self._processFile(file, next);
      }, function done(){
        self.log.info(`Done processing ${server.source.folder} files: ${res.files.length} will start again in XX seconds??`)
        self.log.info(self.interval);
        if (self.interval){
          self.log.info(`Will rerun watch after ${self.interval} seconds`);
          setTimeout(function (){
            self.start();
          }, (self.interval * 1000));
        }
      });
    });
  });
};

// Helper functions.
Watch.prototype._processFile = function(file, callback){
  var self = this;
  file._fileID = createFileID(file);
  file.fileID = file._fileID.id;
  file.changed= false;

  var pipeline = self.pipeline;

  async.waterfall([
    async.apply(pipeline.checkStatus, file),
    pipeline.addToQueue
  ], function waterfallDone(err){
    if (err) self.log.info(err);
    self.log.info(`Pipeline done for id:${file.fileID}:${file.path}`);
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

module.exports = Watch;
