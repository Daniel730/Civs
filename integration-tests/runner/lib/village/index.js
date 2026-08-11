module.exports = {
  ...require('./jobs'),
  ...require('./focus'),
  ...require('./stockpile'),
  ...require('./blueprints'),
  ...require('./walk'),
  ...require('./terrain'),
  construction: require('./construction'),
};
