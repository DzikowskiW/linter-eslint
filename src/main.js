'use babel'

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable, Task } from 'atom'

// Dependencies
let path
let helpers
let workerHelpers
let isConfigAtHomeRoot

// Configuration
const scopes = []
let showRule
let ignoredRulesWhenModified
let ignoredRulesWhenFixing
let disableWhenNoEslintConfig

// Internal functions
const idsToIgnoredRules = ruleIds =>
  ruleIds.reduce((ids, id) => {
    ids[id] = 0 // 0 is the severity to turn off a rule
    return ids
  }, {})

module.exports = {
  activate() {
    const installLinterEslintDeps = () => require('atom-package-deps').install('linter-eslint')
    window.requestIdleCallback(installLinterEslintDeps)

    this.subscriptions = new CompositeDisposable()
    this.active = true
    this.worker = null
    const initializeWorker = () => {
      this.worker = Task.once(require.resolve('./worker.js'))
      this.worker.on('linter-eslint:response', this.handleResponse)
    }

    this.subscriptions.add(
      atom.config.observe('linter-eslint.scopes', (value) => {
        // Remove any old scopes
        scopes.splice(0, scopes.length)
        // Add the current scopes
        Array.prototype.push.apply(scopes, value)
      })
    )

    const embeddedScope = 'source.js.embedded.html'
    this.subscriptions.add(atom.config.observe('linter-eslint.lintHtmlFiles',
      (lintHtmlFiles) => {
        if (lintHtmlFiles) {
          scopes.push(embeddedScope)
        } else if (scopes.indexOf(embeddedScope) !== -1) {
          scopes.splice(scopes.indexOf(embeddedScope), 1)
        }
      })
    )

    this.subscriptions.add(atom.workspace.observeTextEditors((editor) => {
      editor.onDidSave(() => {
        const validScope = editor.getCursors().some(cursor =>
          cursor.getScopeDescriptor().getScopesArray().some(scope =>
            scopes.includes(scope)))
        if (validScope && atom.config.get('linter-eslint.fixOnSave')) {
          if (this.worker === null) {
            initializeWorker()
          }
          if (!path) {
            path = require('path')
          }
          if (!isConfigAtHomeRoot) {
            isConfigAtHomeRoot = require('./is-config-at-home-root')
          }
          if (!workerHelpers) {
            workerHelpers = require('./worker-helpers')
          }
          const filePath = editor.getPath()
          const projectPath = atom.project.relativizePath(filePath)[0]

          // Do not try to fix if linting should be disabled
          const fileDir = path.dirname(filePath)
          const configPath = workerHelpers.getConfigPath(fileDir)
          const noProjectConfig = (configPath === null || isConfigAtHomeRoot(configPath))
          if (noProjectConfig && disableWhenNoEslintConfig) return

          let rules = {}
          if (Object.keys(ignoredRulesWhenFixing).length > 0) {
            rules = ignoredRulesWhenFixing
          }

          // The fix replaces the file content and the cursor jumps automatically
          // to the beginning of the file, so save current cursor position
          const cursorPosition = editor.getCursorBufferPosition()
          this.worker.request('job', {
            type: 'fix',
            config: atom.config.get('linter-eslint'),
            rules,
            filePath,
            projectPath
          }).then(() => {
            // set cursor to the position before fix job
            editor.setCursorBufferPosition(cursorPosition)
          }).catch((err) => {
            atom.notifications.addWarning(err.message)
          })
        }
      })
    }))

    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'linter-eslint:debug': async () => {
        if (this.worker === null) {
          initializeWorker()
        }
        if (!helpers) {
          helpers = require('./helpers')
        }
        const debugString = await helpers.generateDebugString(this.worker)
        const notificationOptions = { detail: debugString, dismissable: true }
        atom.notifications.addInfo('linter-eslint debugging information', notificationOptions)
      }
    }))

    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'linter-eslint:fix-file': () => {
        if (this.worker === null) {
          initializeWorker()
        }
        const textEditor = atom.workspace.getActiveTextEditor()
        const filePath = textEditor.getPath()
        const projectPath = atom.project.relativizePath(filePath)[0]

        if (!textEditor || textEditor.isModified()) {
          // Abort for invalid or unsaved text editors
          atom.notifications.addError('Linter-ESLint: Please save before fixing')
          return
        }

        let rules = {}
        if (textEditor.isModified() && Object.keys(ignoredRulesWhenFixing).length > 0) {
          rules = ignoredRulesWhenFixing
        }

        // The fix replaces the file content and the cursor jumps automatically
        // to the beginning of the file, so save current cursor position
        const cursorPosition = textEditor.getCursorBufferPosition()
        this.worker.request('job', {
          type: 'fix',
          config: atom.config.get('linter-eslint'),
          rules,
          filePath,
          projectPath
        }).then(response =>
          atom.notifications.addSuccess(response)
        ).then(() => {
          // set cursor to the position before fix job
          textEditor.setCursorBufferPosition(cursorPosition)
        }).catch((err) => {
          atom.notifications.addWarning(err.message)
        })
      }
    }))

    this.subscriptions.add(atom.config.observe('linter-eslint.showRuleIdInMessage',
      (value) => {
        showRule = value
      })
    )

    this.subscriptions.add(atom.config.observe('linter-eslint.disableWhenNoEslintConfig',
      (value) => {
        disableWhenNoEslintConfig = value
      })
    )

    this.subscriptions.add(atom.config.observe('linter-eslint.rulesToSilenceWhileTyping', (ids) => {
      ignoredRulesWhenModified = idsToIgnoredRules(ids)
    }))

    this.subscriptions.add(atom.config.observe('linter-eslint.rulesToDisableWhileFixing', (ids) => {
      ignoredRulesWhenFixing = idsToIgnoredRules(ids)
    }))

    window.requestIdleCallback(initializeWorker)
  },
  deactivate() {
    if (this.worker !== null) {
      this.worker.terminate()
      this.worker = null
    }
    this.active = false
    this.subscriptions.dispose()
  },
  provideLinter() {
    return {
      name: 'ESLint',
      grammarScopes: scopes,
      scope: 'file',
      lintOnFly: true,
      lint: (textEditor) => {
        const text = textEditor.getText()
        if (text.length === 0) {
          return Promise.resolve([])
        }
        const filePath = textEditor.getPath()

        let rules = {}
        if (textEditor.isModified() && Object.keys(ignoredRulesWhenModified).length > 0) {
          rules = ignoredRulesWhenModified
        }

        if (this.worker === null) {
          // The worker hasn't gotten a chance to initialize yet from the idle
          // callback, return [] for now
          return []
        }

        this.worker.send('linter-eslint:job', {
          type: 'lint',
          contents: text,
          config: atom.config.get('linter-eslint'),
          rules,
          filePath,
          projectPath: atom.project.relativizePath(filePath)[0] || ''
        }).then((response) => {
          if (textEditor.getText() !== text) {
            /*
               The editor text has been modified since the lint was triggered,
               as we can't be sure that the results will map properly back to
               the new contents, simply return `null` to tell the
               `provideLinter` consumer not to update the saved results.
             */
            return null
          }
          if (!helpers) {
            helpers = require('./helpers')
          }
          return helpers.processESLintMessages(response, textEditor, showRule, this.worker)
        })
      }
    }
  },
  async sendJob(config) {
    return new Promise((resolve) => {
      this.worker
    });
  },
  handleResponse(response) {

  }
}
