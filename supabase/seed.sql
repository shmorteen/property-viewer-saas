-- Public sample tour. It has no organization members and cannot be edited from the dashboard.
insert into public.organizations(id,name,slug,website,created_by) values ('11111111-1111-4111-8111-111111111111','Northline Estates','northline-estates','https://example.com',null) on conflict do nothing;
insert into public.properties(id,organization_id,title,address,description,property_type,bedrooms,bathrooms,status) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','The Willow Residence','24 Willow Lane, London','A light-filled contemporary home with generous living spaces and a calm, considered interior. Explore the principal rooms through the interactive floor plan.','House',3,2,'active') on conflict do nothing;
insert into public.floor_plans(id,property_id,storage_path,width,height) values ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','/demo/floor-plan.svg',1000,700) on conflict do nothing;
insert into public.rooms(id,property_id,name,description,sort_order) values
('44444444-4444-4444-8444-444444444441','22222222-2222-4222-8222-222222222222','Living Room','A welcoming space with garden views and room to unwind.',0),
('44444444-4444-4444-8444-444444444442','22222222-2222-4222-8222-222222222222','Kitchen','A bright, practical kitchen with a central island.',1),
('44444444-4444-4444-8444-444444444443','22222222-2222-4222-8222-222222222222','Principal Bedroom','A quiet retreat with soft natural light.',2) on conflict do nothing;
insert into public.room_media(room_id,storage_path,alt_text,sort_order) values
('44444444-4444-4444-8444-444444444441','/demo/living-room.svg','Illustration of the living room',0),
('44444444-4444-4444-8444-444444444442','/demo/kitchen.svg','Illustration of the kitchen',0),
('44444444-4444-4444-8444-444444444443','/demo/bedroom.svg','Illustration of the principal bedroom',0);
insert into public.room_polygons(floor_plan_id,room_id,points) values
('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444441','[{"x":0.065,"y":0.11},{"x":0.48,"y":0.11},{"x":0.48,"y":0.58},{"x":0.065,"y":0.58}]'),
('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444442','[{"x":0.52,"y":0.11},{"x":0.94,"y":0.11},{"x":0.94,"y":0.58},{"x":0.52,"y":0.58}]'),
('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444443','[{"x":0.065,"y":0.62},{"x":0.48,"y":0.62},{"x":0.48,"y":0.91},{"x":0.065,"y":0.91}]');
insert into public.tours(property_id,slug,published,published_at) values ('22222222-2222-4222-8222-222222222222','the-willow-residence',true,now()) on conflict do nothing;
