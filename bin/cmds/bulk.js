const fs = require('fs-extra');
const path = require('path');
const ezpaarse = require('../..');
const logger = require('../../lib/logger')();
const {
  coerceHeaders,
  pick,
  findInDir,
  isDir,
} = require('../../lib/utils');

const logReg = /\.(log|log\.gz)$/;

exports.command = 'bulk <sourceDir> [destDir]';
exports.aliases = ['b'];
exports.desc = 'Process files from a directory and store results';

exports.builder = yargs => yargs
  .option('H', {
    alias: ['header', 'headers'],
    describe: 'Add a header to the request',
    coerce: coerceHeaders,
  })
  .option('s', {
    alias: 'settings',
    describe: 'Set a predefined setting',
  })
  .option('r', {
    alias: 'recursive',
    describe: 'Look for log files into subdirectories',
    boolean: true,
  })
  .option('d', {
    alias: 'download',
    describe: 'Download a file from the job directory',
  })
  .option('f', {
    alias: ['force', 'overwrite'],
    describe: 'Overwrite existing files',
    boolean: true,
  })
  .option('v', {
    alias: ['verbose'],
    describe: 'Shows detailed operations',
    boolean: true,
  })
  .option('l', {
    alias: 'list',
    describe: 'Only list log files in the directory',
    boolean: true,
  });

exports.handler = async (argv) => {
  const client      = ezpaarse.Client(pick(argv, ['host', 'proxy']));
  const sourceDir   = path.resolve(argv.sourceDir);
  const destDir     = path.resolve(argv.destDir || argv.sourceDir);
  const { verbose } = argv;

  let hasError = false;

  if (!await isDir(sourceDir)) {
    logger.error(`Not a directory: ${sourceDir}`);
    process.exit(1);
  }
  if (!await isDir(destDir)) {
    logger.error(`Not a directory: ${destDir}`);
    process.exit(1);
  }

  const files = (await findInDir(sourceDir, argv.recursive)).filter(f => logReg.test(f.name));

  if (files.length === 0) {
    logger.info('No log files found');
    return;
  }

  if (argv.list) {
    files.forEach(f => console.log(f.path));
    return;
  }

  const startTime = process.hrtime();

  for (const file of files) {
    await processFile(file);
  }

  const elapsed = process.hrtime(startTime)[0];

  if (verbose) {
    logger.info(`Terminated in ${elapsed}s`);
  }

  process.exit(hasError ? 1 : 0);

  async function processFile(file) {
    const resultDir    = path.resolve(destDir, path.relative(sourceDir, path.dirname(file.path)));
    const resultFile   = path.resolve(resultDir, file.name.replace(logReg, '.ec.csv'));
    const resultFileGz = path.resolve(resultDir, file.name.replace(logReg, '.ec.csv.gz'));
    const reportFile   = path.resolve(resultDir, file.name.replace(logReg, '.report.html'));
    const koFile       = `${resultFile}.ko`;

    if (await fs.pathExists(resultFile) && !argv.overwrite) {
      if (verbose) { logger.info(`Skipping ${resultFile}`); }
      return;
    }
    if (await fs.pathExists(resultFileGz) && !argv.overwrite) {
      if (verbose) { logger.info(`Skipping ${resultFileGz}`); }
      return;
    }

    logger.info(`Processing ${file.path}`);

    try {
      await removeRelatedFiles(resultDir, file.name, verbose);
    } catch (e) {
      logger.error(`Failed to remove related files : ${e.message}`);
      hasError = true;
      return;
    }

    try {
      await fs.ensureDir(resultDir);
    } catch (e) {
      logger.error(`Failed to create ${resultDir}`);
      hasError = true;
      return;
    }

    const job = client.createJob(fs.createReadStream(file.path), pick(argv, ['settings', 'headers']));
    let response;

    try {
      response = await job.start();
    } catch (e) {
      hasError = true;

      if (e.code === 'ECONNREFUSED') {
        logger.error(`${e.address}:${e.port} does not respond`);
        process.exit(1);
      } else {
        logger.error(e.message);
        return;
      }
    }

    if (verbose) {
      logger.info(`Job started (ID: ${job.id || 'n/a'})`);
    }

    if (response.statusCode !== 200) {
      hasError = true;

      const ezpaarseMessage = response.headers['ezpaarse-status-message'];
      logger.error(`The job failed with status ${response.statusCode} ${response.statusMessage}`);

      if (ezpaarseMessage) {
        logger.error(`ezPAARSE message : ${ezpaarseMessage}`);
      }

      try {
        await download(job, 'job-report.html', reportFile);
      } catch (e) {
        logger.error(`Failed to download report file : ${e.message}`);
      }

      return;
    }

    try {
      await new Promise((resolve, reject) => {
        response.pipe(fs.createWriteStream(resultFile))
          .on('error', reject)
          .on('finish', resolve);
      });
    } catch (e) {
      hasError = true;

      logger.error(`The job has been interrupted : ${e.message}`);

      try {
        await fs.move(resultFile, koFile, { overwrite: true });
      } catch (err) {
        logger.warning(`Failed to rename the result file : ${err.message}`);
      }
    }

    try {
      await download(job, 'job-report.html', reportFile);
    } catch (e) {
      hasError = true;
      logger.error('Failed to download report file');
    }

    if (argv.download) {
      const downloads = Array.isArray(argv.download) ? argv.download : [argv.download];

      for (const jobFile of downloads) {
        const jobFileDest = path.resolve(resultDir, file.name.replace(logReg, `.${jobFile}`));
        try {
          await download(job, jobFile, jobFileDest);
        } catch (e) {
          hasError = true;
          logger.error(`Failed to download ${jobFile}`);
        }
      }
    }

    if (verbose) {
      logger.info('Job terminated');
    }
  }
};

/**
 * Remove all files with a name based on the given log file
 * @param {string} logFile path to a log file
 */
async function removeRelatedFiles(directory, filename, verbose) {
  const basename = filename.replace(logReg, '');

  const files = (await findInDir(directory))
    .filter(f => f.name.startsWith(basename))
    .filter(f => !logReg.test(f.name));

  for (const file of files) {
    if (verbose) { logger.info(`Removing ${file.name}`); }
    await fs.remove(file.path);
  }
}

/**
 * Download a file from the job directory to a given path
 * @param {Object} job the job to download the file
 * @param {string} filename the file to download
 * @param {string} dest the place to store the file to
 */
function download(job, filename, dest) {
  return new Promise((resolve, reject) => {
    if (!job.id) {
      reject(new Error('Job has no ID'));
      return;
    }

    job.download(filename)
      .pipe(fs.createWriteStream(dest))
      .on('error', reject)
      .on('finish', resolve);
  });
}
