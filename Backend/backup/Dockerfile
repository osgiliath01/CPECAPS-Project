# Nightly encrypted backups of the database (see backup.sh)
FROM postgres:16-alpine
RUN apk add --no-cache gnupg tzdata
COPY backup.sh /usr/local/bin/backup.sh
# The script may have Windows line endings after a checkout on Windows; sh needs Unix ones
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh && chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["schedule"]
