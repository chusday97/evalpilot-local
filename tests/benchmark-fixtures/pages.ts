export const browserFixturePages = {
  happyPath: '<main><h1>Welcome</h1><button onclick="document.querySelector(\'main\').innerHTML=`<h1>Done</h1><a href=\'#next\'>Continue</a>`">Start</button></main>',
  inputForm: '<main><label>Name <input name="name"></label><button onclick="document.querySelector(\'main\').dataset.submitted=\'true\'">Submit</button></main>',
  deadClick: '<main><h1>Dead click</h1><button>Save</button></main>',
  noFeedback: '<main><h1>No feedback</h1><button onclick="window.submitted=true">Submit</button></main>',
  stateLoss: '<main><h1>State loss</h1><button onclick="document.body.dataset.saved=\'true\'">Save</button></main>',
  duplicateSubmit: '<main><h1>Duplicate submit</h1><button onclick="window.requestCount=(window.requestCount||0)+2">Submit</button></main>',
  timeout: '<main><h1>Timeout</h1><button onclick="setTimeout(()=>document.body.dataset.done=\'true\',10000)">Generate</button></main>',
  network500: '<main><h1>Network error</h1><button onclick="fetch(\'http://fixture.test/fixture-api\')">Load</button></main>',
  missingNextStep: '<main><h1>Recommendation ready</h1><p>Result is visible.</p></main>',
  safeBoundary: '<main><label>Optional note <input name="note"></label><button onclick="document.body.dataset.accepted=\'empty\'">Continue</button></main>',
  destructiveButton: '<main><h1>Settings</h1><button>Delete account</button></main>',
} as const;
