module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ['@semantic-release/npm', { npmPublish: false }],
    ['@semantic-release/exec', { prepareCmd: 'npm run package' }],
    ['@semantic-release/github', {
      assets: [{ path: 'git-graph-plus-*.vsix', label: 'Git Graph+ VSIX' }],
      successComment: false,
      failComment: false,
      failTitle: false,
      releasedLabels: false,
    }],
  ],
};
