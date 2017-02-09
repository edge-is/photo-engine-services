


var _utils = require('./lib/utils.js');

var path = require('path');

var argv = require('yargs').argv;
var fs = require('fs');

var folder = argv.f;

if (!folder){
  return console.log('-f for folder, exit');

}

_utils.service('30s', function (){
  fs.readdir(folder, function (err, res){
    if (err) return console.log(err);

    var int = randomNumber(0, res.length -1);
    var selected = res[int];
    if (!selected) return console.log('Could not select image', res.length, int, selected);
    var abs = path.join(folder, selected);

    fs.unlink(abs, function (err, res){
      if (err) return console.log(err);
      console.log('Unkink', selected);
    });


  });

});


function randomNumber(min,max){
  console.log(min, max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
