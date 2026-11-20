import { defineWalkthrough } from '../core';

const ELB = 'https://docs.aws.amazon.com/elasticloadbalancing/latest/application';
const ASG = 'https://docs.aws.amazon.com/autoscaling/ec2/userguide';

/**
 * One HTTPS request into an app in a VPC, then a replacement instance in another zone.
 * Names, addresses and ids are invented (the addresses are from the documentation ranges); the
 * behaviour is checked against the AWS documentation named in each call's `where`.
 */
export const awsVpcRequest = defineWalkthrough({
  id: 'aws-vpc-request',
  title: 'AWS: one HTTPS request into a VPC, then a replacement instance',
  lead: 'A browser reaches an app in a VPC through a name, a load balancer, two security-group checks and an instance, and the instance asks a database. Then the Auto Scaling group brings up an instance in the other zone and retires one in the first.',
  tags: ['aws', 'networking', 'vpc'],

  lanes: [
    { id: 'client', title: 'Browser' },
    { id: 'dns', title: 'Route 53' },
    { id: 'alb', title: 'Load balancer' },
    { id: 'app', title: 'Instance' },
    { id: 'db', title: 'Database' },
    { id: 'asg', title: 'Auto Scaling' },
  ],

  layout: {
    panes: [
      {
        id: 'net',
        panel: 'graph',
        title: 'Network',
        content: {
          initial: true,
          direction: 'DOWN',
          nodes: [
            { id: 'client', label: 'Browser', sub: '198.51.100.7', icon: 'user' },
            { id: 'dns', label: 'Route 53', sub: 'app.example.com', icon: 'globe' },
            {
              id: 'vpc',
              label: 'app-vpc',
              sub: '10.0.0.0/16',
              icon: 'cloud',
              boundary: true,
            },
            { id: 'igw', label: 'Internet gateway', icon: 'gateway', parent: 'vpc' },
            {
              id: 'sg-alb',
              label: 'sg-alb',
              sub: 'in: 443 from anywhere',
              icon: 'shield',
              parent: 'vpc',
            },
            {
              id: 'sg-app',
              label: 'sg-app',
              sub: 'in: 8080 from sg-alb',
              icon: 'shield',
              parent: 'vpc',
            },
            {
              id: 'sg-db',
              label: 'sg-db',
              sub: 'in: 5432 from sg-app',
              icon: 'shield',
              parent: 'vpc',
            },
            { id: 'az-a', label: 'us-east-1a', parent: 'vpc' },
            { id: 'az-b', label: 'us-east-1b', parent: 'vpc' },
            { id: 'pub-a', label: 'public subnet', sub: '10.0.1.0/24', parent: 'az-a' },
            { id: 'pub-b', label: 'public subnet', sub: '10.0.2.0/24', parent: 'az-b' },
            { id: 'priv-a', label: 'app subnet', sub: '10.0.11.0/24', parent: 'az-a' },
            { id: 'priv-b', label: 'app subnet', sub: '10.0.12.0/24', parent: 'az-b' },
            { id: 'data-a', label: 'data subnet', sub: '10.0.21.0/24', parent: 'az-a' },
            {
              id: 'alb-a',
              label: 'ALB node',
              sub: '192.0.2.10',
              icon: 'balancer',
              parent: 'pub-a',
            },
            {
              id: 'alb-b',
              label: 'ALB node',
              sub: '192.0.2.11',
              icon: 'balancer',
              parent: 'pub-b',
            },
            { id: 'i-a1', label: 'i-0a1', sub: 'web', icon: 'server', parent: 'priv-a' },
            { id: 'i-a2', label: 'i-0a2', sub: 'web', icon: 'server', parent: 'priv-a' },
            {
              id: 'i-b1',
              label: 'i-0b1',
              sub: 'web',
              icon: 'server',
              parent: 'priv-b',
              initial: false,
            },
            { id: 'db', label: 'orders-db', sub: 'port 5432', icon: 'database', parent: 'data-a' },
          ],
          edges: [
            { id: 'e-dns', from: 'client', to: 'dns', label: 'A query' },
            { id: 'e-igw', from: 'client', to: 'igw', label: 'HTTPS 443' },
            { id: 'e-alb-a', from: 'igw', to: 'alb-a' },
            { id: 'e-alb-b', from: 'igw', to: 'alb-b' },
            { id: 'e-sg-alb', from: 'sg-alb', to: 'alb-a', label: 'guards' },
            { id: 't-a1', from: 'alb-a', to: 'i-a1', label: 'HTTP 8080', weight: 4 },
            { id: 't-a2', from: 'alb-a', to: 'i-a2', weight: 4 },
            { id: 't-b1', from: 'alb-a', to: 'i-b1', weight: 2.5, initial: false },
            { id: 'g-a1', from: 'sg-app', to: 'i-a1', label: 'guards' },
            { id: 'g-a2', from: 'sg-app', to: 'i-a2' },
            { id: 'g-b1', from: 'sg-app', to: 'i-b1', initial: false },
            { id: 'q-a1', from: 'i-a1', to: 'db', label: 'SQL 5432' },
            { id: 'q-a2', from: 'i-a2', to: 'db' },
            { id: 'q-b1', from: 'i-b1', to: 'db', initial: false },
            { id: 'g-db', from: 'sg-db', to: 'db', label: 'guards' },
          ],
        },
      },
      { id: 'exchange', panel: 'sequence', title: 'Exchange' },
      {
        id: 'health',
        panel: 'table',
        title: 'Target health',
        content: {
          columns: [
            { id: 'target', label: 'Target', mono: true },
            { id: 'zone', label: 'Zone' },
            { id: 'state', label: 'State', mono: true },
            { id: 'note', label: 'Why' },
          ],
          rows: [
            {
              id: 'i-a1',
              cells: { target: 'i-0a1', zone: 'us-east-1a', state: 'healthy', note: '' },
            },
            {
              id: 'i-a2',
              cells: { target: 'i-0a2', zone: 'us-east-1a', state: 'healthy', note: '' },
            },
            {
              id: 'i-b1',
              initial: false,
              cells: {
                target: 'i-0b1',
                zone: 'us-east-1b',
                state: 'initial',
                note: 'registered, not yet checked',
              },
            },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'name',
      title: 'Find the load balancer',
      text: 'The browser knows a name, not an address.',
      calls: [
        {
          id: 'dns-query',
          label: 'Ask for app.example.com',
          from: 'client',
          to: 'dns',
          text: 'The name is an alias record in a Route 53 hosted zone that points at the load balancer.',
          where:
            'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html',
          effects: {
            net: [{ read: 'client' }, { read: 'dns' }, { read: 'e-dns' }],
          },
        },
        {
          id: 'dns-answer',
          label: 'Get the addresses of the load balancer nodes',
          from: 'dns',
          to: 'client',
          text: 'For an alias to a load balancer, Route 53 answers with IP addresses of the load balancer. An Application Load Balancer has one address per enabled zone, one for each of its nodes, so the answer holds both. You cannot set the TTL of an alias that points at an AWS resource.',
          where: `${ELB}/application-load-balancers.html#dns-name and https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html`,
          effects: {
            net: [{ read: 'e-dns', reverse: true }, { read: 'alb-a' }, { read: 'alb-b' }],
          },
        },
      ],
    },
    {
      id: 'enter',
      title: 'Enter the VPC',
      text: 'The first thing the request meets is the edge of the VPC, drawn as a dashed boundary.',
      calls: [
        {
          id: 'connect',
          label: 'Open an HTTPS connection to a load balancer node',
          from: 'client',
          to: 'alb',
          text: 'The browser picks one address, here the node in us-east-1a. The edge that enters the VPC is marked with a gate, and the card says which boundary it crosses: that mark is worked out from where the ends sit, it is not written in the config. The node is in a public subnet; a load balancer has a node in every zone it is given a subnet in, and an Application Load Balancer needs subnets in at least two zones.',
          where: `${ELB}/application-load-balancers.html#subnets-load-balancer`,
          effects: {
            net: [{ read: 'e-igw' }, { read: 'igw' }, { read: 'e-alb-a' }, { read: 'alb-a' }],
          },
        },
        {
          id: 'check-alb',
          label: 'The load balancer’s security group lets it in',
          text: 'A security group holds allow rules only, and a new one allows no inbound traffic until you add rules. This one allows HTTPS from anywhere. It belongs to the VPC, so it is drawn at the VPC level, not inside a zone.',
          where: 'https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html',
          effects: {
            net: [{ read: 'sg-alb' }, { read: 'e-sg-alb' }, { read: 'alb-a' }],
          },
        },
        {
          id: 'forward',
          label: 'Terminate TLS and choose a target',
          from: 'alb',
          to: 'app',
          text: 'An HTTPS listener has a server certificate; the node uses it to end the client’s connection and decrypt the request, then opens a second connection to a target. It sends only to healthy targets, and round robin is the default way to choose.',
          where: `${ELB}/create-https-listener.html, ${ELB}/application-load-balancers.html#load-balancer-connections, ${ELB}/target-group-health-checks.html, ${ELB}/edit-target-group-attributes.html#modify-routing-algorithm`,
          effects: {
            net: [{ read: 'alb-a' }, { read: 't-a1' }, { read: 'i-a1' }],
            health: [{ read: 'i-a1' }, { read: 'i-a2' }],
          },
        },
      ],
    },
    {
      id: 'serve',
      title: 'Serve the request',
      text: 'The instance is in a private subnet, and the database is in a data subnet.',
      calls: [
        {
          id: 'check-app',
          label: 'The instance’s security group admits the load balancer',
          text: 'The rule does not name an address: its source is the load balancer’s security group, so it admits traffic from the network interfaces that group is attached to. The same pattern guards the database below.',
          where:
            'https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html#security-group-referencing',
          effects: {
            net: [{ read: 'sg-app' }, { read: 'g-a1' }, { read: 'i-a1' }],
          },
        },
        {
          id: 'query',
          label: 'Query the database',
          from: 'app',
          to: 'db',
          text: 'The database’s security group allows 5432 only from the instances’ security group.',
          where:
            'https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html#security-group-referencing',
          effects: {
            net: [{ read: 'q-a1' }, { read: 'db' }, { read: 'sg-db' }, { read: 'g-db' }],
          },
        },
        {
          id: 'rows',
          label: 'Rows come back',
          from: 'db',
          to: 'app',
          text: 'The dot now runs the other way: a reply is the same edge read in reverse.',
          effects: { net: [{ read: 'q-a1', reverse: true }, { read: 'i-a1' }] },
        },
        {
          id: 'respond',
          label: 'The instance answers the load balancer',
          from: 'app',
          to: 'alb',
          effects: { net: [{ read: 't-a1', reverse: true }, { read: 'alb-a' }] },
        },
        {
          id: 'deliver',
          label: 'The load balancer answers the browser',
          from: 'alb',
          to: 'client',
          text: 'The response leaves the VPC through the same boundary.',
          effects: {
            net: [
              { read: 'e-alb-a', reverse: true },
              { read: 'e-igw', reverse: true },
            ],
          },
        },
      ],
    },
    {
      id: 'launch',
      title: 'A new instance in the other zone',
      text: 'Both instances are in us-east-1a, because us-east-1b earlier had no capacity for the group. Now it does.',
      calls: [
        {
          id: 'rebalance',
          label: 'The group launches in the zone with the fewest instances',
          from: 'asg',
          to: 'app',
          text: 'An Auto Scaling group tries to keep equal numbers in each zone, so it launches in the zone with the fewest instances. When a zone that lacked capacity recovers, it rebalances by launching first and terminating the earlier instance after. The new instance goes into the app subnet of us-east-1b, a place that was laid out from the start, so nothing else moves.',
          where: `${ASG}/auto-scaling-benefits.html#AutoScalingBehavior.Rebalancing and ${ASG}/autoscaling-load-balancer.html (instances an Auto Scaling group launches are registered with the load balancer automatically)`,
          effects: {
            net: [{ add: 'i-b1' }, { add: 'g-b1' }, { add: 'q-b1' }, { add: 't-b1' }],
            health: [{ add: 'i-b1' }],
          },
        },
        {
          id: 'healthy',
          label: 'It passes a health check and takes traffic',
          text: 'A registered target must pass a health check before it counts as healthy, and the load balancer then sends it requests, from any node, because cross-zone load balancing is on by default for an Application Load Balancer (a target group can turn it off, and this one has not). Each instance now gets a smaller share, drawn as thinner edges.',
          where: `${ELB}/target-group-health-checks.html and ${ELB}/application-load-balancers.html#cross-zone-load-balancing`,
          effects: {
            net: [
              { read: 't-b1' },
              { update: 't-a1', fields: { weight: 2.5 } },
              { update: 't-a2', fields: { weight: 2.5 } },
            ],
            health: [
              {
                update: 'i-b1',
                fields: { state: 'healthy', note: 'passed a health check', tone: 'good' },
              },
            ],
          },
        },
      ],
    },
    {
      id: 'retire',
      title: 'Retire an instance in the first zone',
      calls: [
        {
          id: 'deregister',
          label: 'Deregister i-0a2: it drains',
          from: 'asg',
          to: 'alb',
          text: 'The load balancer stops sending requests to a deregistering target and, by default, waits 300 seconds so that requests in flight can finish. A new request is routed to a healthy target. The target shows as draining until the delay ends.',
          where: `${ELB}/edit-target-group-attributes.html#deregistration-delay and ${ASG}/autoscaling-load-balancer.html (instances an Auto Scaling group terminates are deregistered automatically)`,
          effects: {
            net: [{ read: 't-a2' }, { update: 'i-a2', fields: { tone: 'muted' } }],
            health: [
              {
                update: 'i-a2',
                fields: {
                  state: 'draining',
                  note: 'deregistering, 300 s default delay',
                  tone: 'warn',
                },
              },
            ],
          },
        },
        {
          id: 'terminate',
          label: 'The delay ends and the instance goes',
          text: 'After the delay the target is unused, and an instance of an Auto Scaling group can then be terminated and replaced. Its edges go with it.',
          where: `${ELB}/edit-target-group-attributes.html#deregistration-delay`,
          effects: {
            net: [{ remove: 't-a2' }, { remove: 'g-a2' }, { remove: 'q-a2' }, { remove: 'i-a2' }],
            health: [
              {
                update: 'i-a2',
                fields: { state: 'unused', note: 'terminated', tone: 'muted' },
              },
            ],
          },
        },
      ],
    },
  ],
});
