-- ============================================================================
-- COMPANIO ENGINE — SEED (illustrative demo data for one launch town)
-- ============================================================================

-- Staff
insert into staff(full_name,email,is_admin) values
  ('BRAVO (Operator)','hello@mycompanio.co.uk',true)
on conflict (email) do nothing;

-- Companions (the supply side, one town)
insert into companions(full_name,email,phone,city,postcode,status,dbs,dbs_cleared_on,references_ok,trained_on,offers,hourly_pay,interests,temperament,has_car) values
  ('Linda Hartley','linda@example.com','07700 900101','Guildford','GU1 3AA','active','cleared','2026-03-01',true,'2026-03-05','both',14.00,'{cards,music,tea,history,chat}','chatty',true),
  ('Grace Owens','grace@example.com','07700 900102','Guildford','GU2 7XH','active','cleared','2026-02-10',true,'2026-02-14','companionship',14.00,'{walking,gardening,nature,tea}','active',true),
  ('Margaret Hill','margaret@example.com','07700 900103','Woking','GU21 6XR','active','cleared','2026-01-20',true,'2026-01-25','both',14.50,'{cards,puzzles,music,baking}','playful',false),
  ('Eleanor Voss','eleanor@example.com','07700 900104','Guildford','GU1 4RT','active','cleared','2026-03-12',true,'2026-03-15','help',15.00,'{tech,admin,reading,quiet,tea}','calm',true),
  ('Tom Bridges','tom@example.com','07700 900105','Woking','GU22 7AA','vetting','submitted',null,true,null,'both',14.00,'{tech,football,history,chat}','chatty',true)
on conflict (email) do nothing;

-- A requester (adult child) + their parent (service user)
insert into requesters(full_name,email,phone,status,source,matcher_notes) values
  ('Sarah Mensah','sarah@example.com','07700 900201','active','matcher',
   'For: My mum · Enjoys: A good chat & a cuppa · Frequency: Once a week, gently · Suggested match: Linda')
on conflict (email) do nothing;

insert into service_users(requester_id,full_name,relationship,city,postcode,interests,temperament,notes,mobility_notes)
select r.id,'Joan Mensah','adult_child','Guildford','GU1 3AB','{cards,music,tea,history}','chatty',
       'Loves a long chat and a milky tea. Hard of hearing on the left.','Walks with a stick; short strolls fine.'
from requesters r where r.email='sarah@example.com'
on conflict do nothing;

-- A second user under the same requester (e.g. needs more practical help)
insert into service_users(requester_id,full_name,relationship,city,postcode,interests,temperament,notes)
select r.id,'Albert Mensah','adult_child','Guildford','GU1 3AB','{tech,reading,quiet,tea}','calm',
       'Struggles with his tablet and the post pile. Prefers calm, unhurried company.'
from requesters r where r.email='sarah@example.com'
on conflict do nothing;

-- A booking: Joan, companionship, weekly, assigned to Linda
insert into bookings(requester_id,service_user_id,companion_id,service,frequency,hourly_rate,visit_length_hrs,status,start_date)
select r.id, su.id, c.id, 'companionship','weekly',32.00,2,'active', current_date + 7
from requesters r
join service_users su on su.requester_id=r.id and su.full_name='Joan Mensah'
join companions c on c.full_name='Linda Hartley'
where r.email='sarah@example.com'
on conflict do nothing;
