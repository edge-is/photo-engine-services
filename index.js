


var _utils = require('./lib/utils.js');

var Compare = _utils.compare;


var compare = new Compare('./archives', './fabs', {
  extension : '.png'
}).start();


compare.on('file', function (files){
  console.log(files);
});
