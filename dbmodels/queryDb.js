const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const searchSchema = new Schema({
    query: String,
});

const search = mongoose.model('search', searchSchema);
module.exports = search;