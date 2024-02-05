// Import necessary libraries
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express') // Express framework for building web applications
const app = express() // Initialize an Express application
const port = 3000 // Define the port number on which the server will listen
const MessagingResponse = require('twilio').twiml.MessagingResponse; // // Import the MessagingResponse module from the 'twilio' package
const axios = require('axios');
const cookieParser = require('cookie-parser') // Import and use the cookie-parser middleware
const { Pinecone } = require('@pinecone-database/pinecone')


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

async function sendWhatsappMessage( body, to, sThread) {
  const client = axios.create({
      baseURL: 'https://api.twilio.com/2010-04-01/',
      auth: {
          username: accountSid,
          password: authToken,
      },
  });

  // Add your cookies here
  const cookies = 'sThread=' + sThread;

  // res.cookie('sThread', oResp.sThread, ['Path=/']);

  let url = '/Accounts/' + accountSid + '/Messages.json'
  const options = {
      method: 'post',
      url: url,
      headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies, // Add the cookies to the request headers
      },
      data:  new URLSearchParams({
          From: 'whatsapp:+14155238886',
          Body: body,
          To: to,
      }),
  };

  try {
      const response = await client(options);
      return response.data;
  } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      throw error;
  }
}


// Define a route for handling incoming WhatsApp messages
app.post('/whatsAppIncomingMessage', async (req, res) => {

  // Create a new instance of MessagingResponse to handle Twilio messages
  const twiml = new MessagingResponse()

  // Extract the incoming message and cookies from the request body
  const body = req.body
  const incomingMessage = body.Body
  const To = body.From
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

  console.log("oAssistantResponce" + " " + oAssistantResponce)


  let oMessageResponce = await sendWhatsappMessage(oAssistantResponce.threadMessages.data[0].content[0].text.value, To, oAssistantResponce.sThread); // the separatly message will send because of timeout


  console.log(oAssistantResponce);
  // return { "twimlResponce": twiml.toString(), "sThread": oAssistantResponce.sThread };


  return { "twimlResponce": twiml.toString(), "sThread": oAssistantResponce.sThread };

  // // Create a Twilio message with the response from OpenAI Assistant
  // const message = twiml.message()
  // message.body(oAssistantResponce.threadMessages.data[0].content[0].text.value)

  // // Update the cookie with the latest threadId
  // res.cookie('sThread', oAssistantResponce.sThread, ['Path=/']);

  // // Set the response headers and send the TwiML response
  // res.writeHead(200, { 'Content-Type': 'text/xml' });

  // console.log(twiml.toString());
  // res.status(200).end(twiml.toString());

})

// Define an endpoint to create a new assistant
app.post('/createAssistant', async (req, res) => {
  // Use the OpenAI API to create a new assistant
  const assistant = await openai.beta.assistants.create({
    name: 'Stock Availability Assistant', // Name of the assistant
    description:
      'This intelligent assistant is dedicated to helping you effortlessly track the availability of products, ensuring you stay informed about stock levels in a timely manner', // Description of the assistant
    model: 'gpt-4-1106-preview', // The model used by the assistant
    instructions:
      'You Stock Availability Assistant. I need your help in checking the availability of a specific product. The product Im looking for is [Product Name/Description], and Im interested in knowing its stock availability.You have the function that check the stock . Return message in the same language as user message', // Detailed instructions for the assistant
    tools: [{
      "type": "function",
      "function": {
        "name": "checkStock",
        "description": "check stock for product",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "desription of product" },
          },
          "required": ["query"]
        }
      }
    }] // Additional tools for the assistant (if any)
  })

  res.send(assistant) // Send the created assistant object as a response
})

// Add an endpoint to run the assistant
app.post('/runAssistant', async (req, res) => {
  let body = req.body // Get the request body

  let oResp = await runAssistant(body.sThread, body.sMessage, body.sAssistant)
  // Send the thread messages and thread ID as a response
  res.send(oResp)
})



async function runAssistant(sThread, sMessage, sAssistant) {
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

  //get run object
  run = await openai.beta.threads.runs.retrieve(
    sThread,
    run.id
  );

  if (run.status === "requires_action") {


    await submitToolOutput(sThread, run.id, run.required_action.submit_tool_outputs.tool_calls);
    console.log("submitToolOutput ended")
    await waitForRunComplete(sThread, run.id)
    console.log("waitForRunComplete ended")
  }

  // Retrieve messages from the thread
  const threadMessages = await openai.beta.threads.messages.list(sThread)
  console.log(threadMessages)
  return {
    threadMessages: threadMessages,
    sThread: sThread
  }
}

async function submitToolOutput(sThreadId, sRunId, aToolToCall) {
  console.log("submitToolOutput" + " " + "sRunId" + " " + sRunId + " " + "sThreadId" + " " + sThreadId)

  let aToolOutput = [];
  for (let i = 0; i < aToolToCall.length; i++) {
    if (aToolToCall[i].function.name === "checkStock") {
      console.log("checkStock")

      let args = JSON.parse(aToolToCall[i].function.arguments);
      let sMaterialDescription = args.query;

      //create query embedding
      console.log("create query embedding")
      const embedding = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: sMaterialDescription,
        encoding_format: "float",
      });

      //find the material number in embedding vector storage
      console.log("find the material number in embedding vector storage")
      const pc = new Pinecone({
        apiKey: process.env['PINECONE_API_KEY']
      });
      const index = pc.index(process.env['PINECONE_INDEX']);

      const queryResponse = await index.query({
        vector: embedding.data[0].embedding,
        topK: 3,
        includeValues: false,
        includeMetadata: true,
      });

      console.log(queryResponse)

      //get data from google sheets
      let oGoogleSpreeSheet = await initGoogleSpreadsheet("1YMxMNGldF5dnV0PovDXQHOc5wm1q5tVyeiByeq3Av_s");
      await oGoogleSpreeSheet.loadInfo(); // loads document properties and worksheets
      const sheet = oGoogleSpreeSheet.sheetsByTitle["stock"]; // or use doc.sheetsById[id] or doc.sheetsByTitle[title]
      const aRowsRow = await sheet.getRows();

      //check if material exist 
      let sOutput = "";
      for (var k = 0; k < queryResponse.matches.length; k++) {
        for (var j = 0; j < aRowsRow.length; j++) {
          if (queryResponse.matches[k].metadata.material === aRowsRow[j]._rawData[0]) {
            sOutput = sOutput + "there is" + " " + + aRowsRow[j]._rawData[3] + " pieces of product" + aRowsRow[j]._rawData[2] + " " + "in stock"
          }
        }
      }

      console.log(sOutput)

      aToolOutput.push({
        "tool_call_id": aToolToCall[i].id,
        "output": sOutput
      })
    }
  }

  console.log(aToolOutput)
  await openai.beta.threads.runs.submitToolOutputs(
    sThreadId,
    sRunId,
    {
      tool_outputs: aToolOutput
    }
  );

}

// Define a function to wait for a run to complete
async function waitForRunComplete(sThreadId, sRunId) {
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


// create embedding
app.post('/createMaterialListEmbedding', async (req, res) => {

  //get list of material from google sheets

  let oGoogleSpreeSheet = await initGoogleSpreadsheet("1YMxMNGldF5dnV0PovDXQHOc5wm1q5tVyeiByeq3Av_s");
  await oGoogleSpreeSheet.loadInfo(); // loads document properties and worksheets
  const sheet = oGoogleSpreeSheet.sheetsByTitle["material_list"]; // or use doc.sheetsById[id] or doc.sheetsByTitle[title]
  const aRowsRow = await sheet.getRows();

  const aRowsData = aRowsRow.map(row => {
    return {
      "material": row._rawData[0],
      "category": row._rawData[1],
      "description": row._rawData[2],
      "string": "the material number is " + row._rawData[0] + " and description is " + row._rawData[2],
    }
  });
  //perform embedding with open ai 

  let aEmbeddings = [];


  for (var i = 0; i < aRowsData.length; i++) {
    const embedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: aRowsData[i].description,
      encoding_format: "float",
    });

    aEmbeddings.push({
      id: String(i),
      values: embedding.data[0].embedding,
      metadata: { "material": aRowsData[i].material }
    })

  }
  //save data in vector database
  const pc = new Pinecone({
    apiKey: process.env['PINECONE_API_KEY']
  });
  const index = pc.index(process.env['PINECONE_INDEX']);

  let oRest = await index.upsert(aEmbeddings);



  res.send(oRest)
})


async function initGoogleSpreadsheet(sGoogleSpreadsheet) {

  const serviceAccountAuth = new JWT({
    // env var values here are copied from service account credentials generated by google
    // see "Authentication" section in docs for more info
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
  const doc = new GoogleSpreadsheet(sGoogleSpreadsheet, serviceAccountAuth);

  return doc;
}

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
