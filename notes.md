After looking into the models.py file, I can see that:

### models.py

conversation and document are already a one to many relationship in the DB model, current app logic treats it as one-per-conversation.

The service layer in upload_document enforces only one document per conversation and raises a value error if the conversation already has a document.

get_document_for_conversation returns only one document, even though theoretically it could be many

propogates the "only one" constraint with a 409 error

list endpoint exposes a "has_document" boollean based on length of documents being greater than 0

Detail endpoint exposes a single document field, if there are more it always picks the first one

### messages.py:

code assumes a single document's text in the message/llm flow

HOW TO RESOLVE:
Step 1: STOP ENFORCING "only one document" on upload 2. Expose documents as a list in the api 3. Update the chat/LLM flow to work with multiple document texts (e.g., concatenate, or more advanced retrieval). 4. Update the frontend types and UI to handle multiple documents (list + picker) instead of a single document.

BACKEND CHANGES
Two ways I could do this, first off, I could just delete the uniqueness check and its special error handling, although the better way to handle this would be to replace it with something that returns a list rather than a single

I checked the function for get_document_for_converssation and changed the return to be result.scalars().all() instead of just return result.scalar_one_or_none

A few minor changes sin how the documents are loaded in on messages.py as well.

FRONTEND CHANGES:
Now we need to change the frontend as its still expecting a single document from the backend. To start, I need to identify what files in the frontend need to be modified:

FILES:
types.ts - change wording from document to documents
api.ts - Converted uploadDocument to uploadDocuments to take in multiple filesss as an array
use-documents.ts - preserving the currently selected document if it still exists after refresh
otherwise selecting the first available document
otherwise null if no docs
DocumentUpload.tsx - naming changes to files
EmptyState.tsx - formatting and naming change
ChatInput.tsx Naming convention, upload files persists after the first upload
ChatWindow.tsx name changing
DocumentViewer.tsx added SselectedDocumentID and changed name
App.tsx document to documents

I tried to change the backend to return a list but it created a contract mismatch and UI update issues.

POST /api/conversations/{id}/documents should return the document just created (single object).
To upload 3 files, frontend sends 3 POSTs and aggregates results.

Changes that were actually needed
Backend (needed)
Remove “only one document per conversation” restriction.
Keep Document rows tied to conversation_id so many rows per conversation are allowed.
Make conversation detail return documents: [] (list) so frontend can render selector without refresh.
Keep upload endpoint returning a single created doc per call (stable API contract).
Frontend (needed)
Move state from document to documents[] + selected document id.
Accept list from conversation detail (documents).
Support multi-file selection and drag/drop.
Keep upload button enabled after first upload (add more documents).
Aggregate upload responses and merge into state immediately.
So did we only need frontend changes?
No. We needed both:

backend data/API shape changes for list-based conversation detail and removal of one-doc guard,
frontend UI/state changes for multi-file UX and list rendering.
What we didn’t need was changing upload endpoint to return lists. That part was unnecessary and caused instability.

UI:
Lets move on to UI, I want this to feel like a premium product, and will firsts do a bit of research into premium components to get an idea of how I can modify this. I personally love the look of transparent, frosted glass UI, I first need to understand how the layout is broken up. It seems like there are three components, so to achieve this effect we will need to modify all three components to be transparent.

I've found a shadecn component that has a minimal thread effect, that matches the simplistic and elegant design I am going for, so I will install this, making both side panels blurred but the middle component completely transparent.

Small bugs that annoy me that I want to fix like the delete button being pushed back if the title is too long, also, we need to change the response of the text color to black and wrap it in a frosted background to back my previous design choices.

STAGE 1 Multi-Document Conversations SUMMARY:
So far the application can do what the challenge asked for in part 1

- Upload additional documents to an existing conversation - ✅
- See which documents are loaded in the current conversation - ✅
- Ask questions that can reference any or all uploaded documents - ✅
- View any of the uploaded documents in the reader panel - ✅

**Requirements:**

- The AI should be able to answer questions that span across uploaded documents - ✅
- Previously uploaded documents should persist when new ones are added - ✅

Now lets look at part 2:

Lets first look at the customer feedback

Common themes:
Documents should persist into all conversations
Hallucinations - three comments
Structured Document Comparison
Feature requests - two comments
Feature Request
Detailed Citations

#1 Problem I see is TRUST IN THE PRODUCT! If you can't trust the product you are using you simply will not use it, we need to first identify the best way to remove hallucinations, or at least include an accuracy score and a way for the agent to admit when it doesn't know the answer

Here are the top three most valuable changes to tackle this

1. Hard‑ground the model in retrieved documents only
   What: Force the LLM to answer only using retrieved PDF text; if the answer isn’t clearly in the context, it must say it doesn’t know.
   How:
   In the system prompt (llm.py), add something like:
   “Only answer using the <document> content above. If the answer is not clearly supported there, say you don’t know and explain what’s missing. Never invent clauses, parties, or numbers.”

When you build document_text, keep it to the top‑k most relevant chunks (from a retriever) instead of the full concatenated PDF, and include clear section/page markers so it can cite accurately. 2. Add an explicit “answerability” check before responding
What: Before generating the final answer, have the model (or a cheap classifier) decide: “Can this be answered from the provided context?”. If not, respond with a safe template instead of a free‑form answer.
How (conceptually):
Step 1: Ask the model: “Given this context and question, can it be answered from the context? Answer ONLY with yes or no.”
Step 2: If “no”, return a fixed response like:
“I don’t have enough information in the uploaded documents to answer this reliably. Here’s what I’d need: …”
I implemented this in my role at Venaglass by using cheap LLM models as "judges" to judge the answer that the LLM generated. Its a safe two step approach that I will implement in my testing at the end.

Step 3: Only if “yes”, call your existing chat_with_document to generate the full answer. 3. Make citations mandatory and user‑visible
What: Every material claim must have at least one explicit citation (section / clause / page) that the user can click to verify.
How:
In the system prompt, add strict rules:
“Every factual statement about the document must be followed by a citation in the form (Section X.Y) or (Page N). If you cannot provide a citation, you must mark the statement as uncertain or omit it.”

Adjust your Streamdown content style so cited text is rendered clearly, and wire the UI so clicking a citation scrolls the PDF viewer to that page/section.
Optionally, reject or downgrade answers where count_sources_cited is 0 and show a Low confidence badge instead of treating it as reliable.

STEP 1:
The system prompt is already elluding to this, but it will be safer to be explicit as a high level behavioral change. I've added a more detailed doc string, but am concious not to overload it as it will overload the agents memory and actually slow it down over long conversations, as this doc string will be loaded into its memory every time a question is asked.

STEP 2-3:
I'm going to start with the backend trust pipeline and schema so the answerability gate, citation metadata, and UI can all use the same data contract instead of bolting on one-off fields.

Now I will investigate what files will need to be changed for this to work

llm.py
models.py
messages.py
types.ts
use-messagess.ts
chatwindow.tsx
messageBubble.tsx
App.tsx
DocumentViewer.tsx

The main changes come into play in the llm.py, I've added a secotwo lightweight agents. The first acts as a classifier for grounded legal documents and decides whether a users question can be answered solely from the uploaded documents.

The only con is that this can no longer be used for general conversation as it will return a strict response. Although if you want general conversation this isn't the tool for the job!

The llm can not build an unanswerable response if it doesn't have enough information.

The llm now generates the citations to specific parts of the document to the bottom of the message, as well as a confidence flag of high, medium, or low.

I found the count_sources_cited to be vague and give no value, so replacing it with specific citations that the user can click on and jump right to the clause adds much more value.

Now that the generation is complete, I just need to map these correctly and make sure the front end can reach and surface these values. Starting with models.py, adding the mapped columns

I've added the 002_add_message_trust_metadata file to add the metadata fields in, thesse are added when a user first runs just setup for the first time so no additional steps for someone reviewing are neccessarry

messages.py imports all of the functions created in llm,

    AnswerabilityAssessment,
    assess_answerability,
    build_document_context,
    build_unanswerable_response,
    chat_with_document,
    extract_citations,
    generate_title,
    get_citation_status,
    get_confidence,

so that the response utilises these new functions

types got an upgrade with citations status, answerable, confidence etc. , and citation was added for more explicit citations at the bottom

FRONTEND: I can now pickup these changesx on the frontend, starting with
use-messages.ts
ChatWindow.tsx
MessageBubble.tsx (Created an actual badge to surface the confidence level for each answer)
App.tsx handles the citation click to show what page in the reader on the right
DocumentViewer.tsx also needed to be updated to show the page when a citation is clicked

I needed to add a few extra keys in the config because I needed the loader to ignore unrelated env entries so I could validate the changes in my test file.

Finally, I created a test file to test building all different response types.

SUMMARY:
PROS - Hallucinations have been addressed and lowered, confidence score is given per message, llm clearly states if it does not have the answer to a question, citations are explicit

CONS - marginal increase in respone time, general conversations can no longer be had.

Now lets look at the usage_events.csv
One thing I immediately noticed was the amount of prompts per conversation:

12 conversations had 1 prompt
45 had 2 prompts
36 had 3 prompts
18 had 4 prompts
4 had 5 prompts

With the last bit of extra time, I'll add a way for users to export only the conversation answers to a PDF and copy messages similar to other conversational agents to tick off a few other concerns in the customer feedback.
This requires a new file to wrap, sanitize and export text as a pdf, as well as an update to the messagebuble.tsx to give us the ability on the UI to do this.

TAKE AWAY:
I think this is a good stopping point. I'm concious of time and want to work as if I had a real deadline and needed to make pragmatic decisons on what to change and what to leave for the next PR.

I have identified the major bottleneck (trust) as well as the original problem (multiple document conversations). With more time, I would suggest tackling some of the other user feedback concerns, such as.

Features to highlight and CTRL-F to certain parts of the document, as well as copying messages and exporting them as documents.
I would raise the question surrounding
