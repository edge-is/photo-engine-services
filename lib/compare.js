
var walk = require('walk');

var fs = require('fs');
var path = require('path');

var u = require('./utils.js');


var  Compare = function(options){
  this.rsmq = options.rsmq;
  this.status = options.status;
  this.log = options.log;

  this.supportedExtensions = options.extensions || ['.tiff','.tif', '.jpg', '.jpeg', '.png'];

};


function getConfig(conf, namespace){
  return conf.servers.filter(function (item){
    var name = Object.keys(item).pop();
    return ( namespace === name);
  }).pop();
}

Compare.prototype.start = function (config, namespace, done){
  var self = this;

  var serverConfig = getConfig(config, namespace);

  self.serverSpecificConfig = serverConfig[namespace];
  self.config = config;

  var dir = self.serverSpecificConfig.source.folder;
  var w = walk.walk(dir); //.start();
  w.on('file', function (root, stats, next){

    // 1. Create uniq hash for each folder
    // 2. Check database for last known creation
    // 3. Add to queue if old or not existing
    //

    if (!self.supportedFile(stats.name, self.log)){
      return next();
    }

    var stringToHash = path.join(root, path.parse(stats.name).name);


    var hash = u.md5(stringToHash);

    var fileLocation = path.join(root, stats.name);

    var fileID =  u.md5(fileLocation);
    var now = new Date().getTime();
    var modified = new Date(stats.mtime).getTime();

    var redisMessage = {
      namespace:namespace,
      file : {
        location : 'filesystem',
        path : fileLocation
      },
      timestamp : now,
      fileID:fileID,
      modified : modified
    };


    self.status.get(fileID, function(err, reply) {
      if (err) {
        self.log.error(err);
        return next();
      }

      if (!reply){
        self.log.info(`${stats.name} does not exists, adding to queue for processing`);
        return self._append(redisMessage, fileID, function (err, res){
          if (err) self.log.error(err);

          next();
        });
      }

      if (reply.status==='finished'){

        var timestamp = new Date(parseInt(reply.time)).getTime();

        if (modified > timestamp){
          self.log.info(`${stats.name} does exists, but has changed. Adding to queue`);

          return self._append(redisMessage, fileID, function (err, res){
            if (err) self.log.error(err);

            next();
          });
        }

        // check timestamp ....
      }

      self.log.info(`${stats.name} does exists and has not changed, continue`);
      return next();

    });


  });

  w.on('directory', function (a,b, next){ next();});
  w.on("errors", function (a,b, next){ next();});

  w.on('end', done);
}

Compare.prototype._append = function(redisMessage, fileID, next){
  var self = this;
  var json = u.JSON.stringify(redisMessage);
  var name = path.parse(redisMessage.file.location).name;

  self.rsmq.sendMessage({ qname : self.config.queue, message : json }, function (err, res){
    if (err) return next(`Error adding to queue '${self.serverSpecificConfig.queue}'` +  err);

    self.log.info(`Added: ${name} with ID:${fileID} to queue: ${self.config.queue}, Message ID is: ${res}`);

    self.status.set(fileID, { scannedOn: process.env.HOSTNAME || "", queueID: res, status: "scanned", created : new Date().getTime(), message : json });

    return next();
  });
}

Compare.prototype.supportedFile = function(name){
  var self = this;


  var ext = path.parse(name).ext;

  var name = path.parse(name).name;

  if (name.charAt(0) === '.'){
    self.log.info(`'${name}' is hidden and not a valid file for indexing`);

    return false;
  }

  if (self.supportedExtensions.indexOf(ext) === -1){
    self.log.info(`'${name}' is not an image and not supported`);
    return false;
  }

  return true;

}


module.exports = Compare;
