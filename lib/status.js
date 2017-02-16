var redis = require('redis');




var Status = function (config, redisClient){
  var self = this;

  self.client = redisClient;
  self.config = config;


  return this;
};

/**
 * Gets value
 */

Status.prototype.get = function (callback) {
  var self = this;

  var key = self.config.key;

  self.client.hgetall(key, callback);
};

/**
 * Updates value and publis about it
 */

Status.prototype.update = function (data, callback) {
  var self = this;

  var key = self.config.key;

  var d = createRedisHSET(data);
  self.client.hmset(key, d, function (err, res){
    if (err) return callback(err);

    var message = JSON.stringify({ key : key, data : data });
    self.client.publish(self.config.channel, message, callback);
  });

};

function createRedisHSET(object){
  var arr = [];

  for (var key in object){
    var value = object[key];
    arr.push(key);
    arr.push(value);

  }
  return arr;
}



module.exports = Status;
