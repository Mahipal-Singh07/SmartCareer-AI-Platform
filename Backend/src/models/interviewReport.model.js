const mongoose = require('mongoose');


/**
 * -job description schema:String
 * -resume text:String
 * -Self description:String
 * 
 * -matchScore : Number
 * 
 * -Technical questions :
 * [ {
 *  question:"",
 * intention:"",
 * answer:""
 * }]
 * 
 * -Behaviour questions:
 * [ {
 *  question:"",
 * intention:"",
 * answer:""
 * }]
 * 
 * -Skill gaps:[{
 * skill:"",
 * severity:{
 * type:String,
 * enum:["low","medium","high"]}
 * } ]
 * 
 * -preparation plan:
 * [{
 * day:Number,
 * focus:String,
 * tasks:[String]
 * }]
 */