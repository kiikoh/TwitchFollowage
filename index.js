const fetch = require("node-fetch");
const open = require("open");
const _ = require("underscore");
const Bottleneck = require("bottleneck");
const fs = require("fs");
const moment = require("moment");
const ArgumentParser = require("argparse").ArgumentParser;
const parser = new ArgumentParser({ addHelp: true, description: "Get the foillowage of all viewers in a chat" });
parser.addArgument(["-c", "--channel"], { help: "The channel name" });

const limiter = new Bottleneck({
	reservoir: 750, // initial value
	reservoirIncreaseAmount: 12,
	reservoirIncreaseInterval: 1000, // must be divisible by 250
	reservoirIncreaseMaximum: 800,
	maxConcurrent: 8,
	minTime: 85,
});

const channel = parser.parseArgs().channel.toLowerCase();
const { client_id, client_secret } = JSON.parse(fs.readFileSync("config.json"));

let usersProcessed = 0;

async function syncJSON(url) {
	return await fetch(url).then((res) => res.json());
}

const storeData = (data, path) => {
	try {
		fs.writeFileSync(path, JSON.stringify(data));
	} catch (err) {
		console.error(err);
	}
};

async function getID(username, token) {
	let url = `https://api.twitch.tv/helix/users?login=${username}`;
	return await fetch(url, {
		headers: {
			"Client-ID": client_id,
			Authorization: "Bearer " + token,
		},
	})
		.then((res) => res.json())
		.then((res) => res.data[0].id);
}

async function getIDs(usernames, token) {
	const baseURL = "https://api.twitch.tv/helix/users?";
	let promises = [];
	for (let i = 0; i < usernames.length; i += 100) {
		let url = baseURL;
		for (let user of usernames.slice(i, i + 100)) {
			url += "login=";
			url += user;
			url += "&";
		}
		promises.push(
			fetch(url, {
				headers: {
					"Client-ID": client_id,
					Authorization: "Bearer " + token,
				},
			}).then((res) => res.json())
		);
	}
	let ids = [];
	await Promise.all(promises).then((values) => {
		for (let prom of values) {
			for (let user of prom.data) {
				ids.push(user.id);
			}
		}
	});
	return ids;
}

function getFollowage(from, to, token) {
	let url = `https://api.twitch.tv/helix/users/follows?to_id=${to}&from_id=${from}`;
	return fetch(url, {
		headers: {
			"Client-ID": client_id,
			Authorization: "Bearer " + token,
		},
	})
		.then((res) => res.json())
		.then((res) => {
			console.log(++usersProcessed, res);
			let timeFollowing = 0;
			if (res.total != 0) {
				timeFollowing = Date.now() - new Date(res.data[0].followed_at);
			}
			return timeFollowing;
		})
		.catch((err) => {
			console.error("Going too fast!");
			return 0;
		});
}

async function getAccessToken() {
	let url = `https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`;
	return await fetch(url, { method: "POST" })
		.then((res) => res.json())
		.then((res) => res.access_token);
}

function parseDataToChartJS(data) {
	const buckets = 15;
	const max = Math.max(...data);
	let labels = [];
	for (let i = 0; i < buckets; i++) {
		labels.push((i * max) / buckets);
	}
	let histogram = new Array(buckets).fill(0);
	for (let time of data) {
		histogram[Math.floor(time / labels[1])]++;
	}
	labels.push(max);
	console.log(labels);
	labels = labels.map((e, i) => Math.round(e));
	console.log(labels);
	labels = labels.map((e, i) => moment(new Date() - e).format("MMMM Do YYYY"));
	return {
		type: "bar",
		data: {
			labels: labels,
			datasets: [
				{
					label: `Follow Age of ${data.length} ${channel} Followers`,
					backgroundColor: "rgb(255, 99, 132)",
					borderColor: "rgb(255, 99, 132)",
					data: histogram,
				},
			],
		},
		options: {},
	};
}

function showChart(chart) {
	const url = "https://quickchart.io/chart?c=";
	open(url + JSON.stringify(chart));
}

async function run() {
	let chatters = await syncJSON(`https://tmi.twitch.tv/group/user/${channel}/chatters`);
	console.log("There are currently " + chatters.chatters.viewers.length + " people watching " + channel);
	let bearerToken = await getAccessToken();
	let channelID = await getID(channel, bearerToken);
	let ids = await getIDs(chatters.chatters.viewers, bearerToken);
	Promise.all(
		ids.map((e, i) => {
			return limiter.schedule(() => {
				return getFollowage(e, channelID, bearerToken);
			});
		})
	).then((values) => {
		console.log(values);
		storeData(values, `./data/${channel}_raw.json`);
		let chartjs = parseDataToChartJS(_.without(values, 0));
		storeData(chartjs, `./data/${channel}.json`);
		// showChart(chartjs);
	});
}

run();
