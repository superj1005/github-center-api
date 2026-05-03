import { Octokit } from "octokit";
// import { PRReviewer } from "../services/pr.service.js";
import { getPat } from "../utils/encryption.util.js";
import { responseData } from "../utils/response.util.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function getReviewPR(owner, repo, pullNumber, octokit, gemini) {
  try {
    // 1. Get PR diff
    const diff = await getPRDiff(owner, repo, pullNumber, octokit);

    // 2. Analyze with Gemini
    const analysis = await analyzeWithGemini(diff, gemini);

    // 3. Format review comments
    const {fileSpecificComments, generalFeedback, prDescription} = formatReviewComments(analysis);

    // 4. Return results for UI
    return {
      summary: analysis.summary,
      codeReview: analysis.codeReview,
      testSuggestions: analysis.testSuggestions,
      fileSpecificComments, generalFeedback, prDescription
    };
  } catch (error) {
    console.error("PR review failed:", error);
    throw error;
  }
}

async function getPRDiff(owner, repo, pullNumber, octokit) {
  // Get raw diff
  const diffResponse = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner,
      repo,
      pull_number: pullNumber,
      headers: { accept: "application/vnd.github.v3.diff" },
    }
  );

  // Get changed files
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return {
    diff: diffResponse.data, // raw diff text
    files: files.map((file) => ({
      filename: file.filename,
      changes: file.changes,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    })),
  };
}

async function analyzeWithGemini(diff, gemini) {
  const prompt = `
You are an expert code reviewer analyzing a GitHub pull request. 
In addition to the review, also generate a professional PR description 
that summarizes the purpose, key changes, and impact of this pull request.

Provide:

1. CODE QUALITY:
- Security (SQLi, XSS, auth)
- Performance optimizations
- Code smells/anti-patterns
- Readability
- Architecture

2. BUGS:
- Edge cases not handled
- Logic errors
- Race conditions
- Memory leaks

3. TESTING:
- Unit test cases (Jest/Mocha examples)
- Integration test scenarios
- Mocking strategies

4. ALTERNATIVES:
- More efficient approaches
- Simpler implementations
- Built-in alternatives

5. PULL REQUEST DESCRIPTION:
- Title (short and clear)
- Summary of purpose
- List of key changes
- Potential impact/risk
- Any follow-up work needed

The "Diff" object contains files from GitHub API with:
{
  "filename": "src/api/apiService.ts",
  "patch": "@@ ... -old +new @@\\n+ added line"
}

For file-specific comments use this JSON structure:
{
  "path": "src/api/apiService.ts",
  "line": 265,
  "comment": "Consider renaming 'getPrReview' to 'fetchReview' for consistency.",
  "suggestedCode": "async function fetchReview(...) { ... }"
}

IMPORTANT:
- Only return valid JSON.
- Do not add explanations outside JSON.
- Keep each comment max 3 sentences.
- Suggest minimal corrected code snippets, not whole files.

Diff:
${JSON.stringify(diff.files, null, 2)}

Respond in this JSON format:
{
  "summary": "Overall assessment",
  "codeReview": ["general suggestions"],
  "testSuggestions": ["test cases"],
  "fileSpecificComments": [
    {
      "path": "file.js",
      "line": 42,
      "comment": "Suggestion here",
      "suggestedCode": "Corrected code snippet"
    }
  ],
  "prDescription": {
    "title": "Short PR title",
    "summary": "Why this PR exists",
    "changes": ["Change 1", "Change 2"],
    "impact": "Potential risks or benefits",
    "followUp": ["Next steps if any"]
  }
}
`;

  const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Pass prompt as plain string
  const result = await model.generateContent(prompt);
  const response = await result.response;

  try {
    let text = response.text() || "{}";
    text = text.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Gemini response:", response.text());
    return {
      summary: "",
      codeReview: [],
      testSuggestions: [],
      fileSpecificComments: [],
      prDescription: {
        title: "",
        summary: "",
        changes: [],
        impact: "",
        followUp: [],
      },
    };
  }
}

function formatReviewComments(analysis) {
  const fileSpecificComments = [];

  if (Array.isArray(analysis.fileSpecificComments)) {
    fileSpecificComments.push(
      ...analysis.fileSpecificComments.map((item) => ({
        path: item.path || "unknown_file.js",
        line: item.line || 1,
        side: "RIGHT",
        body: `${item.comment}${
          item.suggestedCode ? `\n\n**Suggested Code:**\n\`\`\`ts\n${item.suggestedCode}\n\`\`\`` : ""
        }`,
      }))
    );
  }

  const generalFeedback = [];

  if (Array.isArray(analysis.codeReview)) {
    generalFeedback.push(
      ...analysis.codeReview.map((comment, idx) => ({
        path: "GENERAL_FEEDBACK.md",
        line: idx + 1,
        side: "RIGHT",
        body: comment,
      }))
    );
  }

  const prDescription = [];

  // Optionally include PR description as a general comment
  if (analysis.prDescription) {
    prDescription.push({
      path: "PR_DESCRIPTION.md",
      line: 1,
      side: "RIGHT",
      body: analysis.prDescription,
    });
  }

  return {fileSpecificComments, generalFeedback, prDescription};
}


export const reviewPR = async (req, res) => {
  try {
    const { repo, pullNumber, userId, ghUsername } = req.query;

    if (!userId) {
      return responseData(res, 400, "userId is required!", false, []);
    }

    if (!ghUsername) {
      return responseData(res, 400, "ghUsername is required!", false, []);
    }

    if (!repo) {
      return responseData(res, 400, "repo is required!", false, []);
    }

    if (!pullNumber) {
      return responseData(res, 400, "pullNumber is required!", false, []);
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;

    const pat = await getPat(userId, ghUsername);
    const octokit = new Octokit({ auth: pat });
    const gemini = new GoogleGenerativeAI(geminiApiKey);

    const review = await getReviewPR(
      ghUsername,
      repo,
      pullNumber,
      octokit,
      gemini
    );

    responseData(res, 200, "PR review generated successfully", true, review);
  } catch (error) {
    console.log(error);

    responseData(res, 500, "Internal server error in reviewPR", false, []);
  }
};

// export const postReview = async (req, res) => {
//   try {
//     const { owner, repo, pullNumber, comments, userId } = req.body;
//     const geminiApiKey = process.env.GEMINI_API_KEY;

//     const pat = await getPat(userId, owner);

//     const reviewer = new PRReviewer(pat, geminiApiKey);
//     await reviewer.postReview(owner, repo, pullNumber, comments);

//     responseData(res, 200, "PR comment post successfully", true, []);
//   } catch (error) {
//     console.log(error);
//     responseData(res, 500, "Internal server error in postReview", false, []);
//   }
// };
