var redis = require('redis');

var async = require('async');



var Status = function (config, redisClient){
  var self = this;

  self.client = redisClient;
  self.config = config;


  return this;
};

/**
 * Gets value
 */


Status.prototype.hasChanged = function(key, fileStats, callback){
  var self = this;

  var o = {
    file_mtime : new Date(fileStats.mtime).getTime().toString(),
    file_cTime : new Date(fileStats.ctime).getTime().toString()
  }
  self.get(key, function (err, res){
    if (err) return callback(err);
    if (res === null) return callback(`No object found with ${key}`);

    if (o.file_cTime === res.file_cTime && o.file_mtime === res.file_mtime){
      return callback(null, false);
    }

    return callback(null, true);

  })
};

Status.prototype.new = function (key, file, queueName, queueID, fileStats, callback) {
  var self = this;
  var now = new Date().getTime();


  var object = {
    status : 'new',
    added : now,
    update : now,
    file : file,
    queueName,
    queueID:queueID,
    file_mtime : new Date(fileStats.mtime).getTime(),
    file_cTime : new Date(fileStats.ctime).getTime()
  };

  self.set(key, object, callback);
};

Status.prototype.failed = function (key, callback) {
  var self = this;
  var now = new Date().getTime();

  self.update(key, { status : 'failed', update : now }, callback);
};

Status.prototype.working = function (key, callback) {
  var self = this;
  var now = new Date().getTime();

  self.update(key, { status : 'working', update : now }, callback);
};

Status.prototype.done = function (key, callback) {
  var self = this;
  var now = new Date().getTime();

  self.update(key, { status : 'finished', update : now }, callback);
};

Status.prototype.get = function (key, callback) {
  var self = this;

  self.client.hgetall(key, callback);
};

/**
 * Updates value and publis about it
 */
Status.prototype.update = function (key, data, callback) {
  var self = this;

  var d = objectToRedisArray(data);
  self.client.hmset(key, d, function (err, res){
    if (err) return callback(err);

    var message = JSON.stringify({
      key : key,
      changes : data,
      timestamp: new Date().getTime(),
      server : process.env.HOSTNAME,
      type: 'update',
    });


    self.client.publish(self.config.channel, message, callback);
  });

};



Status.prototype.set = function (key, data, callback) {
  var self = this;

  function hExists(object, callback){
    object.client.hgetall(object.key, function (err, res){
      if (err) return callback(err);

      if (res){
        object.exists = true;
      }

      callback(null, object);

    })
  }
  function hDelete(object, callback){
    if (!object.exists) return callback(null, object);

    object.client.del(object.key, function (err, res){
      if (err) return callback(err);

      callback(null, object);
    });

  }
  function hSet(object, callback){
    var d = objectToRedisArray(object.data);
    self.client.hmset(object.key, d, function (err, res){
      if (err) return callback(err);

      var message = JSON.stringify({
        key : object.key,
        changes : object.data,
        timestamp: new Date().getTime(),
        server : process.env.HOSTNAME,
        type: 'set',
      });
      self.client.publish(object.channel, message, callback);
    });
  }

  var obj = {
    client : self.client,
    key : key,
    data : data,
    exists : false,
    channel : self.config.channel
  };

  async.waterfall([
    async.apply(hExists, obj ),
    hDelete,
    hSet
  ],callback);
};

function objectToRedisArray(object){
  var arr = [];

  for (var key in object){
    var value = object[key];

    if (typeof value === 'object'){
      value = JSON.stringify(value);
    }

    arr.push(key);
    arr.push(value);

  }
  return arr;
}



module.exports = Status;
