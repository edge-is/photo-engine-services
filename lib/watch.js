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

  self.pipelines = {};
  self.config.servers.forEach(function (server){
    server.serverID = u.md5(JSON.stringify(server));
    self.pipelines[server.serverID] = createPipeline({ log : self.log, queue : self.queue, status : self.status, config : server });
  })

  return self;
};

Watch.prototype.start = function () {
  var self = this;
  async.forEachLimit(self.config.servers, 1, function (server, next){
    self.log.info({ folder : server.source.folder }, 'Starting');


    var pipeline = self.pipelines[server.serverID];
    if (!pipeline) return self.log.error('Could not load pipeline');


    scanForFiles(server.source.folder, function (err, res){
      if (err) {
        self.log.error({folder : server.source.folder}, 'Could not scan directory', err);
        return next(err);

      }

      var fileCount = res.files.length;

      var i = 0;

      self.log.debug({folder : server.source.folder, total : fileCount }, `Found files ${fileCount}, starting processing files with concurrency:${self.concurrency}`);

      async.forEachLimit(res.files, self.concurrency, function eachFile(file, done){
        file._serverConfig = server;
        file.file = {
          location : 'filesystem',
          path : file.path
        };

        self.log.debug({folder : server.source.folder, total : fileCount, current : i, file : file.path }, `Processing file`);
        i++;
        return self._processFile(file, pipeline, done);
      }, function (err){
        if (err) {
          self.log.warn({ folder : server.source.folder, total : fileCount }, err);
        } else{
          self.log.info({ folder : server.source.folder, total : fileCount }, `Done processing all files`)
        }
        next();
      });
    });
  }, function allServersDone(){

    if (self.interval){
      self.log.info(`Will rerun watch after ${self.interval/1000} seconds`);
      setTimeout(function (){
        self.start();
      }, self.interval);
    }
  });
};

// Helper functions.
Watch.prototype._processFile = function(file, pipeline, callback){
  var self = this;
  file._fileID = createFileID(file);
  file.fileID = file._fileID.id;
  file.changed= false;



  async.waterfall([
    async.apply(pipeline.checkStatus, file),
    pipeline.addToQueue
  ], function waterfallDone(err){
    if (err) self.log.info(err);

    self.log.info({ fileId:file.fileID , file : file.path }, `Pipeline done`);
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
