FROM postgres:latest

RUN mkdir /socket && chmod 0777 /socket
COPY setup.sh setup.sql /docker-entrypoint-initdb.d/
