// ui.js
const blessed  = require('blessed');
const contrib = require('blessed-contrib');

// 1) Create a full-screen terminal "screen"
const screen = blessed.screen({
  smartCSR: true,
  title: 'Arb Bot Dashboard'
});

// 2) Lay out a 12×12 grid on that screen
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// 3) Add a line chart (top half)
const line = grid.set(0, 0, 6, 12, contrib.line, {
  label: 'Profit Over Time',
  showLegend: true,
  maxY: 1,       // adjust if your profits exceed 1 ETH
  wholeNumbersOnly: false,
  style: { line: 'yellow', text: 'green', baseline: 'black' }
});

// 4) Add a table (bottom half)
const table = grid.set(6, 0, 6, 12, contrib.table, {
  keys: true,
  label: 'Recent Trades',
  columnWidth: [10, 10, 20],
  interactive: false
});

// 5) Render once to show the empty widgets
screen.render();

// Export two functions to update these widgets
module.exports = {
  updateChart: (times, profits) => {
    line.setData([{ title: 'ETH', x: times, y: profits }]);
    screen.render();
  },
  updateTable: rows => {
    table.setData({ headers: ['Time', 'Profit', 'TxHash'], data: rows });
    screen.render();
  }
};
