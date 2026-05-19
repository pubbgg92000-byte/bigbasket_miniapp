# OTP Login Endpoint Findings

Scope: local HTTP Toolkit capture only. No new OTP/login requests were sent.

## Endpoints

- `POST https://www.bigbasket.com/member-tdl/v3/member/otp/`
- `POST https://www.bigbasket.com/member-tdl/v3/member/unified-login/`

## Captured Results

| Masked number | Endpoint | HTTP | Response message | Inference | Event ID |
|---|---:|---:|---|---|---|
| ******4921 | otp | 400 | Your account does not exist/inactive. Please contact our customer care. Call: 1860-123-1000 or Email: customerservice@bigbasket.com. | Not registered or inactive | 7f6cfdf5-3fd0-4210-b6c7-44ccd2fe03af |
| ******3072 | otp | 200 | OTP sent successfully | Registered/live enough to receive OTP | 5a6ddb0c-ddc1-47d2-be21-ae34252855df |
| ******3072 | otp | 200 | OTP sent successfully | Registered/live enough to receive OTP | 15081909-c06c-4b12-b9a4-78841501c28d |
| ******3072 | unified-login | 400 | Please Enter Valid OTP. | OTP was issued, but submitted OTP was invalid | 28e56362-dda9-4df4-873d-b8d92c993e75 |
| ******3072 | unified-login | 200 |  | Registered/live and login succeeded | 8f8a562b-8097-4742-997a-ee50a9815460 |

## Interpretation

- A `400` from `/member/otp/` with “account does not exist/inactive” means the submitted number is not currently usable for login in this flow.
- A `200` from `/member/otp/` with “OTP sent successfully” means the submitted number is accepted by the login flow and is live/registered enough to receive OTP.
- A `400` from `/member/unified-login/` with “Please Enter Valid OTP” means the OTP/refId path is valid, but the OTP value was rejected.
- A `200` from `/member/unified-login/` returning session tokens/customer identifiers means login succeeded for that number.
- I did not see a captured response explicitly saying blocked.
