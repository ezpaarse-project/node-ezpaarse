const Job = require('./lib/job');

function Client(opts) {
  const options = opts || {};
  const protocol = options.protocol || 'http';
  const host = options.host || 'localhost:59599';
  const { proxy } = options;

  function createJob(...args) {
    return new Job({ protocol, host, proxy }, ...args);
  }

  return {
    createJob,
  };
}

module.exports = {
  Client,
};
