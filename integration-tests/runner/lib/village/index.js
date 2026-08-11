module.exports = {
  ...require('./jobs'),
  ...require('./stockpile'),
  ...require('./blueprints'),
  ...require('./walk'),
  ...require('./terrain'),
  construction: require('./construction'),
};
