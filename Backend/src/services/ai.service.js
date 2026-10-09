const {GoogleGenAI} = require("@google/genai")
const {z} = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")

const ai =new GoogleGenAI({
    apiKey:process.env.GOOGLE_GENAI_API_KEY
})


const interviewReportSchema = z.object({
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job describe"),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Technical questions that can be asked in the interview along with their intention and how to answer them"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Behavioral questions that can be asked in the interview along with their intention and how to answer them"),
    skillGaps: z.array(z.object({
        skill: z.string().describe("The skill which the candidate is lacking"),
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap, i.e. how important is this skill for the job and how much it can impact the candidate's chances")
    })).describe("List of skill gaps in the candidate's profile along with their severity"),
    preparationPlan: z.array(z.object({
        day: z.number().describe("The day number in the preparation plan, starting from 1"),
        focus: z.string().describe("The main focus of this day in the preparation plan, e.g. data structures, system design, mock interviews etc."),
        tasks: z.array(z.string()).describe("List of tasks to be done on this day to follow the preparation plan, e.g. read a specific book or article, solve a set of problems, watch a video etc.")
    })).describe("A day-wise preparation plan for the candidate to follow in order to prepare for the interview effectively"),
    title: z.string().describe("The title of the job for which the interview report is generated"),
})

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {


    const prompt = `
You are an expert technical interviewer and interview preparation coach.

Generate a detailed interview preparation report using the candidate's resume,
self-description, and the job description.

Return ONLY a valid JSON object matching the provided schema.

Requirements:
- matchScore: integer between 0 and 100.
- technicalQuestions: generate 10 relevant technical interview questions.
  Each must include question, intention, and a detailed sample answer.
- behavioralQuestions: generate 5 behavioral interview questions.
  Each must include question, intention, and a suggested answer personalized
  to the candidate's actual experience.
- skillGaps: identify 3-5 genuine skill gaps relevant to the job.
  Each must include skill and severity (low, medium, or high).
- preparationPlan: create a practical 7-day preparation plan.
  Each day must include day, focus, and a list of actionable tasks.
- title: the job title from the job description.

IMPORTANT:
1. Do not generate a resume evaluation or hiring recommendation.
2. Do not include candidate_info, strengths, contact, or final_recommendation.
3. Do not invent achievements, metrics, or experience absent from the inputs.
4. Answers should be specific, technically accurate, and useful for interview preparation.
5. Follow the JSON schema exactly.

RESUME:
${resume}

SELF-DESCRIPTION:
${selfDescription}

JOB DESCRIPTION:
${jobDescription}
`

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(interviewReportSchema),
        }
    })

   console.log(JSON.parse(response.text))


}
module.exports=generateInterviewReport