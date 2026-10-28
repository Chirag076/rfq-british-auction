#!/bin/sh
# Container start-up, as a script rather than a chain of shell operators in a
# compose file and a deployment config.
#
# Two reasons. Shell operators in a hosting provider's "start command" field
# get re-quoted on the way to the container and stop meaning what they say;
# and a start sequence that differs between local and production is a start
# sequence that is only tested in one of them.
set -e

# `db push` rather than `migrate deploy`: this project has no migration
# history, and generating one would be pretending to a rigour it does not have.
# A real deployment would run migrations here.
npx prisma db push --skip-generate

# exec so node becomes PID 1 and receives SIGTERM directly. Without it the
# shell holds PID 1, swallows the signal, and the platform waits out its
# shutdown grace period on every single deploy.
exec node dist/main
