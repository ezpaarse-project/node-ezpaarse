const Job = require('./lib/job');

function Client(opts) {
  const options = opts || {};
  const host = options.host || 'localhost:59599';
  const { proxy } = options;

  function createJob(...args) {
    return new Job({ host, proxy }, ...args);
  }

  return {
    createJob,
  };
}

module.exports = {
  Client,
};
