Fix duplicate email registration in the chat app (server/).
- User schema: email required, unique: true, lowercase: true, trim: true
- Register route: normalize email (trim + lowercase), check if it already exists, and return 409 with message "Email already registered" before creating the user; also handle Mongo duplicate key error (code 11000) with the same 409 response
- Client: show that error message on the register form
- Login: normalize email the same way
- Do not change anything else. Keep it minimal, no extra tests.