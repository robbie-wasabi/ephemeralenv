create table users (
  id serial primary key,
  email text not null unique,
  name text not null
);
