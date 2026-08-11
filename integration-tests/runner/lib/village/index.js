module.exports = {
  ...require('./jobs'),
  ...require('./stockpile'),
  ...require('./blueprints'),
  ...require('./walk'),
  construction: require('./construction'),
};
