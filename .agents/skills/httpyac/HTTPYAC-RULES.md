# httpyac Rules

Comprehensive rules for working with httpyac .http files for API testing. Rules are organized by category with severity indicators.

## Severity Levels

- **[C]ritical**: Must never be violated - will cause execution failure
- **[H]igh**: Should almost never be violated - core patterns
- **[M]edium**: Follow unless good reason not to - best practices
- **[L]ow**: Guidelines and preferences - style choices

---

## [P] Protocol Selection

### [H] P-1: Choose Protocol Based on Service Definition

Match the protocol to the service definition type.

**When to use each protocol**:
- **HTTP/REST**: Plain HTTP endpoints without proto definitions
- **gRPC**: Services defined in .proto files with RPC methods
- **GraphQL**: GraphQL endpoints (typically `/graphql`)
- **WebSocket**: Real-time bidirectional communication needs

**Example - Identifying from proto**:
```protobuf
// proto/user/v1/user.proto
service User {
  rpc Create(CreateUserRequest) returns (CreateUserResponse);  // Use gRPC
}
```

**Rule**: If a proto file defines the service, use gRPC protocol. If endpoint is plain HTTP REST, use HTTP protocol.

---

## [H] HTTP Requests

### [H] H-1: Request Line Syntax

HTTP request line consists of method, URL, and optional HTTP version.

**Pattern**: `METHOD URL [HTTP/VERSION]`

**Example**:
```http
POST http://{{HOST}}/pubsub/useraccess
Content-Type: application/json

{
    "org_id": "63802627-fd2e-4f24-81c9-8e6670c54d06"
}
```

**Methods**: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS

**Rule**: Use uppercase method names. HTTP version is optional but recommended for HTTP/2 control.

---

### [H] H-2: Headers and Authentication

Headers follow standard HTTP format with colon separator.

**Pattern**: `Header-Name: value`

**Common headers**:
- `Content-Type: application/json`
- `Authorization: Bearer {{JWT}}`
- `Accept: application/json`

**Example with authentication**:
```http
POST http://{{HOST}}/api/endpoint
Authorization: Bearer {{JWT}}
Content-Type: application/json

{"data": "value"}
```

**Rule**: Authorization headers MUST use variable substitution for tokens: `{{JWT}}` or `{{TOKEN}}`.

---

### [M] H-3: Request Body Formats

Request body comes after headers, separated by blank line.

**JSON body**:
```http
POST http://{{HOST}}/api/endpoint
Content-Type: application/json

{
    "field": "value",
    "nested": {
        "key": "data"
    }
}
```

**Imported body**:
```http
POST http://{{HOST}}/api/endpoint
Content-Type: application/json

< ./request-body.json
```

**Variable substitution in imported body**:
```http
POST http://{{HOST}}/api/endpoint
Content-Type: application/json

<@ ./request-body-template.json
```

**Rule**: Use `<` for importing static files. Use `<@` to enable variable substitution in imported files.

---

### [M] H-4: Variable Substitution

Variables use double curly brace syntax: `{{variable}}`

**Variable definition**:
```http
@host = https://api.example.com
@userId = 12345

GET {{host}}/users/{{userId}}
```

**Variable in URL**:
```http
GET http://{{HOST}}/api/users/{{USER_ID}}
```

**Variable in body**:
```http
POST http://{{HOST}}/api/users
Content-Type: application/json

{
    "organizationId": "{{ORGANIZATION_ID}}",
    "email": "{{USER_EMAIL}}"
}
```

**Rule**: Always use `{{variable}}` syntax. Single braces `{variable}` will NOT work.

---

### [H] H-4b: Dotenv vs Process Environment

`$dotenv` and `$processEnv` are different sources.

**Example**:
```http
@BASE_URL = {{$dotenv LIGHTRAG_BASE_URL}}
@API_TOKEN = {{$processEnv API_TOKEN}}
```

- `{{$dotenv KEY}}` reads from httpyac-loaded dotenv files
- `{{$processEnv KEY}}` reads from the actual process environment

**Rule**: Use `{{$dotenv KEY}}` for values expected from `.env*` files. Use `{{$processEnv KEY}}` only for real process environment variables.

---

### [L] H-5: Query Parameters

Query parameters can be inline or multi-line.

**Inline**:
```http
GET http://{{HOST}}/api/users?limit=10&offset=0
```

**Multi-line**:
```http
GET http://{{HOST}}/api/users
  ?limit=10
  &offset=0
  &sort=created_at
```

**With variables**:
```http
GET http://{{HOST}}/api/users
  ?organizationId={{ORG_ID}}
  &limit={{PAGE_LIMIT}}
```

**Rule**: Use multi-line format for queries with 3+ parameters for readability.

---

### [M] H-6: Region Delimiters

Separate multiple requests with `###` delimiter.

**Example**:
```http
### Get User
GET http://{{HOST}}/api/users/{{USER_ID}}

### Create User
POST http://{{HOST}}/api/users
Content-Type: application/json

{"email": "test@example.com"}

### Delete User
DELETE http://{{HOST}}/api/users/{{USER_ID}}
```

**Rule**: Each request region MUST be separated by `###`. Add descriptive title after delimiter.

---

### [M] H-7: Region Title Becomes Request Name

If no explicit `# @name` is set, the title after `###` is also used as the request name.

**Example**:
```http
### getUser
GET https://httpbin.org/json
```

**Rule**: Make region titles unique, or add explicit `# @name` metadata to avoid collisions.

---

## [M] Meta Data and Variables

### [H] M-1: Request Naming for Response Capture

Name requests to capture responses as variables.

**Syntax**: `# @name variableName`

**Example**:
```http
# @name loginResponse
POST http://{{HOST}}/api/login
Content-Type: application/json

{
    "username": "{{DEV_USER}}",
    "password": "{{DEV_PASS}}"
}

###

# Use captured response
GET http://{{HOST}}/api/profile
Authorization: Bearer {{loginResponse.token}}
```

**JSON response access**:
```http
# @name userResponse
GET http://{{HOST}}/api/users/123

###

# Access nested fields
POST http://{{HOST}}/api/posts
Content-Type: application/json

{
    "authorId": "{{userResponse.data.id}}",
    "authorEmail": "{{userResponse.data.email}}"
}
```

**Rule**: Use `@name` to capture responses. Access JSON fields with dot notation: `{{responseName.field}}`.

---

### [H] M-1b: Name Uniqueness and Valid JavaScript Identifiers

Request names must:

- Be unique across imported files
- Be valid JavaScript variable names
- Not be JavaScript keywords

**Rule**: Never reuse `@name` accidentally across imported files.

---

### [M] M-2: Request Dependencies with @ref

Reference other requests to ensure they execute first.

**Syntax**: `# @ref requestName`

**Example**:
```http
# @name authenticate
POST http://{{HOST}}/api/login
Content-Type: application/json

{"username": "user", "password": "pass"}

###

# @ref authenticate
# @name getUserProfile
GET http://{{HOST}}/api/profile
Authorization: Bearer {{authenticate.token}}

###

# @ref getUserProfile
PUT http://{{HOST}}/api/profile
Authorization: Bearer {{authenticate.token}}
Content-Type: application/json

{
    "name": "{{getUserProfile.name}}",
    "bio": "Updated bio"
}
```

**@forceRef for always execute**:
```http
# @forceRef authenticate
GET http://{{HOST}}/api/data
Authorization: Bearer {{authenticate.token}}
```

**Rule**: Use `@ref` when you need cached response. Use `@forceRef` to always re-execute dependency.

---

### [M] M-2b: Cross-File Imports

Import requests explicitly before referencing them from other files.

**Pattern**:
```http
# @import ./auth.http
# @ref loginResponse
GET http://{{HOST}}/api/profile
Authorization: Bearer {{loginResponse.token}}
```

**Rule**: Use `# @import` for cross-file reuse instead of duplicating bootstrap requests.

---

### [H] M-3: Variable Scoping and Definition

Variables can be defined globally or per-file.

**File-level variables**:
```http
@HOST = https://lxuidev.praxie.com
@ORGANIZATION_ID = 63802627-fd2e-4f24-81c9-8e6670c54d06

### Request using variables
POST http://{{HOST}}/api/endpoint
Content-Type: application/json

{"orgId": "{{ORGANIZATION_ID}}"}
```

**Environment-specific variables**:
```http
# Use .env file or httpyac environments
@HOST = {{$processEnv HOST}}
@JWT = {{$processEnv JWT}}
```

**Script-generated variables**:
```http
{{
  const timestamp = Date.now();
  const requestId = `req-${timestamp}`;
  exports.timestamp = timestamp;
  exports.requestId = requestId;
}}

###

POST http://{{HOST}}/api/events
Content-Type: application/json

{
    "timestamp": {{timestamp}},
    "requestId": "{{requestId}}"
}
```

**Rule**: Define reusable variables at file top. Use script blocks `{{ }}` for dynamic values.

---

### [M] M-4: Request Descriptions

Add descriptions with comments or metadata.

**Comment-based description**:
```http
# User Access PubSub Request
# Triggers user access processing via pubsub

### User Access PubSub Request
POST http://{{HOST}}/pubsub/useraccess
Content-Type: application/json

{"org_id": "{{ORG_ID}}"}
```

**Metadata description**:
```http
# @description Authenticates user and returns JWT token
# @name authToken
POST http://{{HOST}}/api/login
Content-Type: application/json

{"username": "user", "password": "pass"}
```

**Rule**: First comment of region automatically becomes description. Use for documenting request purpose.

---

## [G] gRPC Requests

### [C] G-1: Proto File Imports with includeDirs

gRPC requests MUST import proto files and configure include directories.

**Pattern**:
```
proto < ../../../proto/service/v1/file.proto
includeDirs: ["../../proto"]
```

**Example from user-service**:
```http
proto < ../../../proto/user/v1/user.proto
includeDirs: ["../../proto"]

### Create User
GRPC {{HOST}}/upboard.io.user.v1.User/Create

{
    "email": "newuser@example.com",
    "username": "New User"
}
```

**Example from entitlement**:
```http
proto < ../../../../proto/entitlement/v1/entitlement.proto
includeDirs: ["../../proto"]
```

**Rule**: Proto path MUST be relative from .http file to proto file. includeDirs MUST point to proto root for nested imports.

---

### [H] G-2: gRPC Request Line Syntax

gRPC request line uses GRPC keyword with full service path.

**Pattern**: `GRPC {{HOST}}/package.service/Method`

**Example**:
```http
GRPC {{HOST}}/upboard.io.user.v1.User/Create
```

**With authentication**:
```http
GRPC {{HOST}}/upboard.io.entitlement.v1.EntitlementService/Query
Authorization: Bearer {{JWT}}
```

**Service path structure**:
- Package: `upboard.io.user.v1`
- Service: `User`
- Method: `Create`
- Full path: `upboard.io.user.v1.User/Create`

**Rule**: Service path MUST match proto package + service + method exactly. Case-sensitive.

---

### [H] G-3: Message Format Options

Configure proto JSON mapping with metadata.

**Common options**:
```http
proto < ../../../proto/service/v1/file.proto
keepCase: true
includeDirs: ["../../proto"]
longs: String
enums: String
defaults: true
```

**Option descriptions**:
- `keepCase: true` - Preserve field name casing (snake_case from proto)
- `longs: String` - Represent int64/uint64 as strings (avoid JS number precision loss)
- `enums: String` - Use enum string names instead of numbers
- `defaults: true` - Include default values in response

**Example effect**:
```protobuf
// Proto definition
message User {
  string user_name = 1;
  int64 user_id = 2;
  Status status = 3;
}
```

**With keepCase: false (default)**:
```json
{
  "userName": "john",
  "userId": "123",
  "status": "ACTIVE"
}
```

**With keepCase: true**:
```json
{
  "user_name": "john",
  "user_id": "123",
  "status": "ACTIVE"
}
```

**Rule**: Use `keepCase: true` when proto uses snake_case. Use `longs: String` for large numbers.

---

### [H] G-4: Unary gRPC Request Pattern

Unary requests send one message and receive one response.

**Pattern**:
```http
proto < ../../../proto/service/v1/file.proto
includeDirs: ["../../proto"]

### Request Name
GRPC {{HOST}}/package.service/Method

{
    "field": "value"
}
```

**Complete example**:
```http
proto < ../../../proto/user/v1/user.proto
includeDirs: ["../../proto"]

### Create User
# @name createUserResponse
GRPC {{HOST}}/upboard.io.user.v1.User/Create

{
    "email": "newuser@example.com",
    "username": "New User",
    "password": "tempPassword123",
    "organizationId": "{{ORGANIZATION_ID}}",
    "inviterUserId": "{{INVITER_ID}}",
    "showEntitlementCoachMarks": false,
    "isInactive": false,
    "recentBoards": []
}
```

**Rule**: Unary requests are the default gRPC pattern. One request message, one response message.

---

### [H] G-5: Server Streaming Pattern

Server streaming sends one message, receives multiple responses.

**Pattern**:
```http
proto < ./proto
proto < ./service.proto

GRPC /package.Service/StreamingMethod
{
  "request": "data"
}
```

**Example with response handling**:
```http
proto < ./proto
proto < ./hello.proto

# @name streamResponse
GRPC /HelloService/LotsOfReplies
{
  "greeting": "world"
}

{{@afterResponse
  console.log('Received stream message:', response.body);
}}
```

**Rule**: Server streaming receives multiple responses. Use `@afterResponse` script to handle each message.

---

### [H] G-6: Client Streaming Pattern

Client streaming sends multiple messages, receives one response.

**Pattern**:
```http
GRPC /package.Service/ClientStreamingMethod
{
  "initial": "message"
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      message: "second"
    });
    await sleep(1000);
    $requestClient.send({
      message: "third"
    });
  }
  exports.waitPromise = writeStream();
}}
```

**Example**:
```http
proto < ./proto
proto < ./hello.proto

GRPC /HelloService/lotsOfGreetings
{
  "greeting": "world."
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      greeting: 'How are you?',
    });
    await sleep(1000);
    $requestClient.send({
      greeting: 'I can stream.',
    });
  }
  exports.waitPromise = writeStream();
}}
```

**Rule**: Use `@streaming` metadata and `$requestClient.send()` to send multiple messages. MUST export promise.

---

### [H] G-7: Bidirectional Streaming Pattern

Bidirectional streaming sends and receives multiple messages concurrently.

**Pattern**:
```http
GRPC /package.Service/BidiMethod
{
  "initial": "message"
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      message: "next"
    });
  }
  exports.waitPromise = writeStream();
}}

{{@afterResponse
  console.log('Received:', response.body);
}}
```

**Example**:
```http
proto < ./proto
proto < ./grpcbin.proto

GRPC /HelloService/BidiHello
{
  "greeting": "world"
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      greeting: ', how are you?',
    });
    await sleep(1000);
    $requestClient.send({
      greeting: ', I can stream.',
    });
  }
  exports.waitPromise = writeStream();
}}
```

**Rule**: Combine `@streaming` for sending and `@afterResponse` for receiving. Both operate concurrently.

---

### [M] G-8: gRPC Reflection

Enable gRPC reflection for dynamic service discovery.

**Pattern**:
```http
# @grpcReflection
GRPC {{HOST}}/package.Service/Method

{
  "field": "value"
}
```

**Example**:
```http
# @grpcReflection
GRPC grpc.postman-echo.com/HelloService/sayHello

{
  "greeting": "world"
}
```

**Rule**: Use `@grpcReflection` when proto files not available. Server must support gRPC reflection.

---

### [M] G-9: gRPC Error Handling

Handle gRPC status codes in response scripts.

**Status code checking**:
```http
proto < ../../../proto/user/v1/user.proto
includeDirs: ["../../proto"]

# @name createResult
GRPC {{HOST}}/upboard.io.user.v1.User/Create

{
    "email": "test@example.com"
}

{{@afterResponse
  if (response.statusCode !== 0) {
    console.error('gRPC Error:', response.statusCode, response.statusMessage);
  } else {
    console.log('Success:', response.body);
  }
}}
```

**Common gRPC status codes**:
- 0: OK
- 3: INVALID_ARGUMENT
- 5: NOT_FOUND
- 7: PERMISSION_DENIED
- 16: UNAUTHENTICATED

**Rule**: Check `response.statusCode === 0` for success. Non-zero indicates gRPC error.

---

## [Q] GraphQL Requests

### [H] Q-1: GraphQL Endpoint POST Pattern

GraphQL requests use POST with query in body.

**Pattern**:
```http
POST https://api.example.com/graphql
Content-Type: application/json

query QueryName($var: Type!) {
  field(arg: $var) {
    subfield
  }
}

{
  "var": "value"
}
```

**Example**:
```http
POST https://api.github.com/graphql
Content-Type: application/json
Authorization: Bearer {{git_api_key}}

query test($name: String!, $owner: String!) {
  repository(name: $name, owner: $owner) {
    name
    fullName: nameWithOwner
    forkCount
    stargazers(first: 5) {
        totalCount
        nodes {
            login
            name
        }
    }
  }
}

{
    "name": "vscode-httpyac",
    "owner": "AnWeber"
}
```

**Rule**: Query/mutation goes in request body. Variables follow in JSON object below query.

---

### [M] Q-2: GraphQL Query with Fragments

Use fragments to reuse field selections.

**Pattern**:
```http
fragment FragmentName on Type {
  field1
  field2
}

POST https://api.example.com/graphql
Content-Type: application/json

query {
  item {
    ...FragmentName
    otherField
  }
}
```

**Example**:
```http
###
fragment IOParts on Repository {
  description
  diskUsage
}

POST https://api.github.com/graphql
Content-Type: application/json
Authorization: Bearer {{git_api_key}}

query test($name: String!, $owner: String!) {
  repository(name: $name, owner: $owner) {
    name
    fullName: nameWithOwner
    ...IOParts
    forkCount
  }
}

{
    "name": "vscode-httpyac",
    "owner": "AnWeber"
}
```

**Rule**: Define fragments before POST request. Use `...FragmentName` to spread fields.

---

### [M] Q-3: GraphQL Mutations

Mutations modify data, same structure as queries.

**Pattern**:
```http
POST https://api.example.com/graphql
Content-Type: application/json
Authorization: Bearer {{token}}

mutation CreateItem($input: ItemInput!) {
  createItem(input: $input) {
    id
    name
    createdAt
  }
}

{
  "input": {
    "name": "New Item",
    "description": "Item description"
  }
}
```

**Rule**: Use `mutation` keyword instead of `query`. Variables passed in JSON object below.

---

### [H] Q-4: GraphQL Variable Passing

Variables declared in query and passed in separate JSON object.

**Pattern**:
```http
POST https://api.example.com/graphql
Content-Type: application/json

query QueryName($var1: Type!, $var2: Type) {
  field(arg1: $var1, arg2: $var2) {
    result
  }
}

{
  "var1": "required value",
  "var2": "optional value"
}
```

**Required vs optional**:
- `$var: Type!` - Required (exclamation mark)
- `$var: Type` - Optional (no exclamation mark)

**Rule**: Declare variables in query signature. Pass actual values in JSON object. Match types exactly.

---

### [L] Q-5: GraphQL File Imports

Import GraphQL queries from external files.

**Pattern**:
```http
POST https://api.example.com/graphql
Content-Type: application/json
Authorization: Bearer {{token}}

gql queryName < ./query.gql

{
    "variable": "value"
}
```

**Example**:
```http
POST https://api.github.com/graphql
Content-Type: application/json
Authorization: Bearer {{git_api_key}}

gql foo < ./graphql.gql

{
    "name": "vscode-httpyac",
    "owner": "AnWeber"
}
```

**Rule**: Use `gql name < ./file.gql` to import query from file. Variables still passed inline.

---

## [W] WebSocket Requests

### [H] W-1: WebSocket Connection Syntax

WebSocket connections use WS or WSS keyword.

**Pattern**:
```http
WS wss://example.com/path

{
  "initial": "message"
}
```

**Example**:
```http
WS wss://socketsbay.com/wss/v2/1/demo/

{
  "test": "httpyac"
}
```

**Rule**: Use `WS` for ws:// and `WSS` for wss:// (secure). Initial message sent on connection.

---

### [M] W-2: WebSocket Initial Message

Send initial message on connection.

**JSON message**:
```http
WS wss://example.com/socket

{
  "type": "subscribe",
  "channel": "updates"
}
```

**Text message**:
```http
WS wss://example.com/socket

subscribe:updates
```

**Rule**: Message after connection line sent immediately. Use JSON for structured data.

---

### [H] W-3: WebSocket Streaming with @streaming

Use @streaming metadata for bidirectional communication.

**Pattern**:
```http
WS wss://example.com/socket

{
  "initial": "message"
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      "event": "data"
    });
  }
  exports.waitPromise = writeStream();
}}
```

**Example**:
```http
WS wss://socketsbay.com/wss/v2/1/demo/

{
  "test": "httpyac"
}

{{@streaming
  async function writeStream() {
    await sleep(10000);
    $requestClient.send({
      "event": "ping",
      "reqid": 45
    });
    await sleep(1000);
  }
  exports.waitPromise = writeStream();
}}
```

**Rule**: Use `@streaming` metadata. Function MUST be async and MUST export promise.

---

### [H] W-4: $requestClient.send() for Additional Messages

Send additional messages using $requestClient.

**Pattern**:
```http
{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send(messageData);
  }
  exports.waitPromise = writeStream();
}}
```

**JSON messages**:
```javascript
$requestClient.send({
  "type": "message",
  "data": "value"
});
```

**Text messages**:
```javascript
$requestClient.send("text message");
```

**Rule**: `$requestClient.send()` available in @streaming script. Pass JSON object or string.

---

### [L] W-5: WebSocket Keep-Alive

Keep connection open for receiving messages.

**Pattern**:
```http
# @keepStreaming
WS wss://example.com/socket

{
  "subscribe": "channel"
}
```

**With timeout**:
```http
# @keepStreaming
# @timeout 30000
WS wss://example.com/socket

{
  "subscribe": "channel"
}
```

**Rule**: Use `@keepStreaming` to prevent connection close. Set `@timeout` for max duration (milliseconds).

---

## [S] Scripting and Testing

### [H] S-1: Pre-Request Scripts

Execute scripts before request with `{{ }}` block.

**Pattern**:
```http
{{
  // Script code
  const value = calculateValue();
  exports.variableName = value;
}}

### Request
GET http://{{HOST}}/api/endpoint?param={{variableName}}
```

**Example**:
```http
{{
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).substring(7);
  const signature = require('crypto')
    .createHash('sha256')
    .update(`${timestamp}:${nonce}`)
    .digest('hex');

  exports.timestamp = timestamp;
  exports.nonce = nonce;
  exports.signature = signature;
}}

### Authenticated Request
POST http://{{HOST}}/api/endpoint
X-Timestamp: {{timestamp}}
X-Nonce: {{nonce}}
X-Signature: {{signature}}
Content-Type: application/json

{"data": "value"}
```

**Rule**: Use `{{ }}` for pre-request scripts. Export variables with `exports.name = value`.

---

### [H] S-2: Post-Request Scripts

Execute scripts after response with specific hooks.

**@afterResponse hook**:
```http
POST http://{{HOST}}/api/endpoint
Content-Type: application/json

{"data": "value"}

{{@afterResponse
  console.log('Status:', response.statusCode);
  console.log('Body:', response.body);

  if (response.statusCode === 200) {
    exports.apiToken = response.body.token;
  }
}}
```

**Multiple hooks**:
```http
GET http://{{HOST}}/api/data

{{@afterResponse
  console.log('Response received');
}}

{{@afterResponse
  const data = response.body;
  exports.processedData = data.items.map(i => i.id);
}}
```

**Rule**: Use `{{@afterResponse }}` for post-request scripts. Access response via `response` object.

---

### [H] S-3: Response Assertions

Test response data with assertions.

**Simple assertion**:
```http
GET http://{{HOST}}/api/users/{{USER_ID}}

{{@afterResponse
  test('Status is 200', () => {
    expect(response.statusCode).toBe(200);
  });

  test('User has email', () => {
    expect(response.body.email).toBeDefined();
  });
}}
```

**Chai assertions**:
```http
GET http://{{HOST}}/api/users

{{@afterResponse
  const chai = require('chai');
  const expect = chai.expect;

  test('Response is array', () => {
    expect(response.body).to.be.an('array');
  });

  test('Has users', () => {
    expect(response.body).to.have.length.greaterThan(0);
  });
}}
```

**Rule**: Use `test()` function with assertions. Use `expect()` or chai for assertions.

---

### [C] S-4: Async Patterns with exports.waitPromise

Async scripts MUST export promise.

**Pattern**:
```http
{{
  async function asyncOperation() {
    const result = await someAsyncCall();
    exports.data = result;
  }
  exports.waitPromise = asyncOperation();
}}
```

**Example with delay**:
```http
{{
  async function setupData() {
    await sleep(1000);

    const response = await fetch('https://api.example.com/config');
    const config = await response.json();

    exports.apiKey = config.apiKey;
    exports.endpoint = config.endpoint;
  }
  exports.waitPromise = setupData();
}}

### Use exported variables
GET {{endpoint}}/data
Authorization: Bearer {{apiKey}}
```

**Rule**: When script is async, MUST export promise as `exports.waitPromise`. Script waits for completion.

---

### [M] S-5: test() Function Usage

test() function simplifies assertion syntax.

**Basic test**:
```javascript
test('description', () => {
  expect(actual).toBe(expected);
});
```

**Multiple assertions**:
```javascript
test('User response validation', () => {
  expect(response.statusCode).toBe(200);
  expect(response.body.id).toBeDefined();
  expect(response.body.email).toContain('@');
  expect(response.body.isActive).toBe(true);
});
```

**Async test**:
```javascript
test('Async validation', async () => {
  const data = await processResponse(response.body);
  expect(data.valid).toBe(true);
});
```

**Rule**: Use descriptive test names. Group related assertions in same test.

---

### [M] S-6: Global Variables with $global

Store variables across requests with $global.

**Set global variable**:
```http
# @name login
POST http://{{HOST}}/api/login
Content-Type: application/json

{"username": "user", "password": "pass"}

{{@afterResponse
  $global.authToken = response.body.token;
  $global.userId = response.body.userId;
}}
```

**Use global variable**:
```http
### Later request in different file
GET http://{{HOST}}/api/users/{{$global.userId}}
Authorization: Bearer {{$global.authToken}}
```

**Rule**: Use `$global.name` to store persistent variables. Available across all requests and files.

---

## [E] Environment and Configuration

### [H] E-1: CLI Execution Pattern

Use consistent CLI flags for execution.

**Pattern**: `httpyac -o=OUTPUT_FORMAT -a ./path/to/file.http`

**Common output formats**:
- `body` - Response body only
- `headers` - Response headers only
- `response` - Full response (status + headers + body)
- `short` - Status and timing only
- `none` - No output

**Example commands**:
```bash
# Execute single file, show body
httpyac -o=body -a ./path/to/file.http

# Execute with verbose output
httpyac -o=response -v ./path/to/file.http

# Execute all requests in directory
httpyac -o=body -a ./path/to/*.http

# Silent mode
httpyac -s -o=none ./path/to/file.http
```

**Additional flags**:
- `-a, --all` - Execute all requests in file
- `-v, --verbose` - Verbose output
- `-s, --silent` - Silent mode
- `-e, --env <env>` - Specify environment
- `--var <key=value>` - Pass variables

**Rule**: Use `-o=body -a` as default pattern. Add `-v` for debugging.

---

### [M] E-2: Variable Files and Environments

Define environment-specific variables in separate files.

**Directory structure**:
```
project-root/
  .env
  .env.dev
  .env.stage
  .env.prod
  httpyac.config.js
```

**.env file**:
```bash
HOST=https://api.example.com
API_KEY=your_api_key_here
DEV_USER=testuser
DEV_PASS=password123
```

**Using environment variables in .http files**:
```http
@HOST = {{$processEnv HOST}}
@API_KEY = {{$processEnv API_KEY}}

### Request
POST http://{{HOST}}/api/endpoint
Authorization: Bearer {{API_KEY}}
Content-Type: application/json

{"data": "value"}
```

**Specify environment in CLI**:
```bash
httpyac -o=body -a -e dev ./path/to/file.http
httpyac -o=body -a -e prod ./path/to/file.http
```

**Supported dotenv names**:
```bash
.env
.env.local
local.env
```

**Rule**: Store dotenv-managed values in `.env*` files and read them with `{{$dotenv VAR}}`. Use `{{$processEnv VAR}}` only for true process environment variables.

---

### [H] E-2b: Dotenv Search Locations and Cache

httpyac searches dotenv files in:

- The same directory as the `.http` file
- The project root
- The `env/` folder in project root
- The directory pointed to by `HTTPYAC_ENV`

If dotenv files change outside VS Code, `httpyac.reset` may be needed.

**Rule**: When dotenv resolution is wrong, check project root first, then search path, then reset cache.

---

### [H] E-2c: Project Root Detection

Project root is the closest directory containing one of:

- `package.json`
- `httpyac.config.js`
- `.httpyac.js`
- `.httpyac.json`
- `env/`

**Example**:
```text
repo/
  package.json
  examples/httpyac-api/httpyac.config.js
  examples/httpyac-api/00-system.http
```

Requests under `examples/httpyac-api/` use that subdirectory as their httpyac project root.

**Rule**: Add a local `httpyac.config.js` when a subdirectory must isolate its own dotenv files from a larger repo.

---

### [M] E-2d: envDirName

`envDirName` changes the env lookup folder name, but does not change project-root detection.

**Example**:
```js
module.exports = {
  envDirName: 'env',
};
```

**Rule**: Do not rely on `envDirName` to isolate a subdirectory. Use a local config file for that.

---

### [H] E-3: Proto File Path Resolution

Proto paths MUST be relative from .http file to proto file.

**Path calculation example**:
```
.http file location: api-tests/grpc/user/create.http
proto file location: protos/user/v1/user.proto
relative path: ../../../protos/user/v1/user.proto
```

**Step-by-step calculation**:
1. Start from .http file: `api-tests/grpc/user/create.http`
2. Go up to common ancestor: `../../../` (up 3 levels)
3. Navigate to proto: `protos/user/v1/user.proto`
4. Result: `../../../protos/user/v1/user.proto`

**includeDirs calculation**:
- Points to proto root directory for nested imports
- Example: if proto root is `protos/`, use `["../../protos"]` from .http file location

**Complete example**:
```http
proto < ../../protos/user/v1/user.proto
includeDirs: ["../protos"]

GRPC {{HOST}}/package.service.v1.ServiceName/Method
{
  "field": "value"
}
```

**Rule**: Count directories from .http file to proto file using relative paths. Set includeDirs to proto root for imports.

---

## Examples

### Complete HTTP Example

```http
# Variables
@HOST = https://api.example.com
@API_KEY = your_api_key_here

# Create Resource Request
# Demonstrates HTTP POST with JSON body

### Create Resource
# @name createResponse
POST http://{{HOST}}/api/resources
Authorization: Bearer {{API_KEY}}
Content-Type: application/json

{
    "name": "Example Resource",
    "description": "Created via httpyac"
}

{{@afterResponse
  test('Status is 200 or 201', () => {
    expect([200, 201]).toContain(response.statusCode);
  });

  test('Response has ID', () => {
    expect(response.body.id).toBeDefined();
  });

  console.log('Resource created:', response.body.id);
  exports.resourceId = response.body.id;
}}
```

### Complete gRPC Unary Example

```http
# Variables
@HOST = grpc.example.com
@API_KEY = your_api_key_here

# Proto configuration
proto < ../../protos/user/v1/user.proto
keepCase: true
includeDirs: ["../protos"]
longs: String
enums: String
defaults: true

### Create User
# @name createUserResponse
GRPC {{HOST}}/example.user.v1.UserService/CreateUser
Authorization: Bearer {{API_KEY}}

{
    "email": "newuser@example.com",
    "username": "John Doe",
    "full_name": "John Doe",
    "status": "ACTIVE"
}

{{@afterResponse
  test('User created successfully', () => {
    expect(response.statusCode).toBe(0);
    expect(response.body.user_id).toBeDefined();
  });

  console.log('Created user:', response.body.user_id);
  exports.newUserId = response.body.user_id;
}}
```

### Complete gRPC Streaming Example

```http
proto < ./proto
proto < ./grpcbin.proto
@host=grpc.postman-echo.com/

### Client Streaming
GRPC /HelloService/lotsOfGreetings
{
  "greeting": "world."
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      greeting: 'How are you?',
    });
    await sleep(1000);
    $requestClient.send({
      greeting: 'I can stream.',
    });
  }
  exports.waitPromise = writeStream();
}}

### Bidirectional Streaming
GRPC /HelloService/BidiHello
{
  "greeting": "world"
}

{{@streaming
  async function writeStream() {
    await sleep(1000);
    $requestClient.send({
      greeting: ', how are you?',
    });
    await sleep(1000);
    $requestClient.send({
      greeting: ', I can stream.',
    });
  }
  exports.waitPromise = writeStream();
}}

{{@afterResponse
  console.log('Received message:', response.body);
}}
```

### Complete GraphQL Example

```http
@git_api_key = YOUR_TOKEN_HERE

###
fragment IOParts on Repository {
  description
  diskUsage
}

### Query Repository
# @name repoInfo
POST https://api.github.com/graphql
Content-Type: application/json
Authorization: Bearer {{git_api_key}}

query test($name: String!, $owner: String!) {
  repository(name: $name, owner: $owner) {
    name
    fullName: nameWithOwner
    ...IOParts
    forkCount
    stargazers(first: 5) {
        totalCount
        nodes {
            login
            name
        }
    }
    watchers {
        totalCount
    }
  }
}

{
    "name": "vscode-httpyac",
    "owner": "AnWeber"
}

{{@afterResponse
  test('Repository found', () => {
    expect(response.statusCode).toBe(200);
    expect(response.body.data.repository).toBeDefined();
  });
}}
```

### Complete WebSocket Example

```http
### WebSocket Connection with Streaming
WS wss://socketsbay.com/wss/v2/1/demo/

{
  "test": "httpyac",
  "action": "connect"
}

{{@streaming
  async function writeStream() {
    await sleep(5000);
    $requestClient.send({
      "event": "ping",
      "timestamp": Date.now()
    });

    await sleep(5000);
    $requestClient.send({
      "event": "data",
      "reqid": 45,
      "payload": "test data"
    });

    await sleep(2000);
  }
  exports.waitPromise = writeStream();
}}

{{@afterResponse
  console.log('WebSocket message received:', response.body);
}}
```
