'use babel'
// Note: 'use babel' doesn't work in forked processes
process.title = 'linter-eslint helper'

import Path from 'path'
import * as Helpers from './worker-helpers'
import {create} from 'process-communication'
import {findCached, FindCache} from 'atom-linter'

create().onRequest('job', function({contents, type, config, filePath}, job) {
  global.__LINTER_ESLINT_RESPONSE = []

  if (config.disableFSCache) {
    FindCache.clear()
  }

  const fileDir = Path.dirname(filePath)
  const eslint = Helpers.getESLintInstance(fileDir, config)
  const configPath = Helpers.getConfigPath(fileDir)
  const relativeFilePath = Helpers.getRelativePath(fileDir, filePath, config)

  const argv = Helpers.getArgv(config, relativeFilePath, fileDir, configPath)

  if (type === 'lint') {
    job.response = lintJob(argv, contents, eslint)
  } else if (type === 'fix') {
    job.response = fixJob(argv, eslint)
  }
})

function lintJob(argv, contents, eslint) {
  eslint.execute(argv, contents)
  return global.__LINTER_ESLINT_RESPONSE
}
function fixJob(argv, eslint) {
  argv.push('--fix')
  try {
    process.argv = argv
    eslint.execute(argv)
    return 'Linter-ESLint: Fix Complete'
  } catch (err) {
    throw new Error('Linter-ESLint: Fix Attempt Completed, Linting Errors Remain')
  }
}

process.exit = function() { /* Stop eslint from closing the daemon */ }
