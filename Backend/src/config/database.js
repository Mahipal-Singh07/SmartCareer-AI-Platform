const mongoose = require('mongoose');

async function connectToDB() {
try{
    await mongoose.connect(process.env.MONGO_URI) 
console.log("Connected to database")
}
catch (err) {
  console.error("MongoDB connection failed:", err.message);
  throw err;
}
}

module.exports = connectToDB