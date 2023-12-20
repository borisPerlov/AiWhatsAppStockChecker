// Import necessary libraries
const express = require('express') // Express framework for building web applications
const app = express() // Initialize an Express application
const port = 3000 // Define the port number on which the server will listen
const MessagingResponse = require('twilio').twiml.MessagingResponse; // // Import the MessagingResponse module from the 'twilio' package
const cookieParser = require('cookie-parser') // Import and use the cookie-parser middleware
app.use(cookieParser());

// Load environment variables from the .env file
require('dotenv').config()

// Middleware to parse JSON bodies in requests
app.use(express.json())
// Middleware to parse URL-encoded bodies (as sent by HTML forms)
app.use(
  express.urlencoded({
    extended: true
  })
)



// Import the OpenAI library
const OpenAI = require('openai')
// Create an OpenAI client with the API key from the .env file
const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY']
})

// Define a route for handling incoming WhatsApp messages
app.post('/whatsAppIncomingMessage', async (req, res) => {
  
  // Create a new instance of MessagingResponse to handle Twilio messages
  const twiml = new MessagingResponse()

  // Extract the incoming message and cookies from the request body
  const body = req.body
  const incomingMessage = body.Body
  const cookies = req.cookies

  // Initialize a variable to store the threadId (conversation container)
  let sThread = ''

  // Check if cookies contain a threadId; if yes, assign it to the variable
  if (cookies && cookies.sThread) {
    sThread = cookies.sThread
  }

  // Call the runAssistant function to get a response from OpenAI Assistant
  let oAssistantResponce = await runAssistant(
    sThread,
    incomingMessage,
    process.env['assistant']// add assistant to .env

  )

  // Create a Twilio message with the response from OpenAI Assistant
  const message = twiml.message()
  message.body(oAssistantResponce.threadMessages.data[0].content[0].text.value)

  // Update the cookie with the latest threadId
  res.cookie('sThread', oAssistantResponce.sThread, ['Path=/']);
  
  // Set the response headers and send the TwiML response
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.status(200).end(twiml.toString());

})

// Define an endpoint to create a new assistant
app.post('/createAssistant', async (req, res) => {
  // Use the OpenAI API to create a new assistant
  const assistant = await openai.beta.assistants.create({
    name: 'Melody Maker', // Name of the assistant
    description:
      'A versatile lyricist for all music genres, inspiring creativity', // Description of the assistant
    model: 'gpt-4-1106-preview', // The model used by the assistant
    instructions:
      'Melody Maker is a creative assistant specialized in songwriting...', // Detailed instructions for the assistant
    tools: [] // Additional tools for the assistant (if any)
  })

  res.send(assistant) // Send the created assistant object as a response
})

// Add an endpoint to run the assistant
app.post('/runAssistant', async (req, res) => {
  let body = req.body // Get the request body

  let oResp = runAssistant(body.sThread, body.sMessage, body.sAssistant)
  // Send the thread messages and thread ID as a response
  res.send(oResp)
})

async function runAssistant (sThread, sMessage, sAssistant) {
  // Check if it's a new conversation or an existing thread
  if (!sThread) {
    let oThread = await openai.beta.threads.create()
    sThread = oThread.id
  }

  // Add a message to the thread
  await openai.beta.threads.messages.create(sThread, {
    role: 'user',
    content: sMessage
  })

  // Run the assistant with the provided thread
  let run = await openai.beta.threads.runs.create(sThread, {
    assistant_id: sAssistant
  })

  // Wait for the run to complete
  await waitForRunComplete(sThread, run.id)

  // Retrieve messages from the thread
  const threadMessages = await openai.beta.threads.messages.list(sThread)

  return {
    threadMessages: threadMessages,
    sThread: sThread
  }
}

// Define a function to wait for a run to complete
async function waitForRunComplete (sThreadId, sRunId) {
  while (true) {
    const oRun = await openai.beta.threads.runs.retrieve(sThreadId, sRunId)
    if (
      oRun.status &&
      (oRun.status === 'completed' ||
        oRun.status === 'failed' ||
        oRun.status === 'requires_action')
    ) {
      break // Exit loop if run is completed, failed, or requires action
    }
    // Delay the next check to avoid high frequency polling
    await new Promise(resolve => setTimeout(resolve, 1000)) // 1-second delay
  }
}

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
