const fs = require("fs");
let data = JSON.parse(fs.readFileSync("./data/xqcow_raw.json"));

data.sort((a, b) => b.timeFollowing - a.timeFollowing);

console.log(data.slice(0, 10));
