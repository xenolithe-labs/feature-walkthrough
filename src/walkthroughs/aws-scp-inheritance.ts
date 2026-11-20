import { defineWalkthrough } from '../core';

const EVAL =
  'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html';
const DENY_ALLOW =
  'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html';
const BASICS =
  'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-basics.html';
const SCP_EVAL =
  'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html';
const SCPS =
  'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html';
const KEYS =
  'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html';

/** The made-up service control policy that decides the first request. */
const REGION_POLICY = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'DenyOutsideApprovedRegions',
      Effect: 'Deny',
      NotAction: ['iam:*', 'organizations:*', 'sts:*', 'support:*'],
      Resource: '*',
      Condition: {
        StringNotEquals: { 'aws:RequestedRegion': ['eu-west-1', 'eu-central-1'] },
      },
    },
  ],
};

/**
 * Is this API call allowed? An organisation of units and accounts, service control policies
 * attached at several levels, and the order in which AWS evaluates them. Names, ids and policies
 * are made up. Facts are checked against AWS documentation (links in `where`); what the pages
 * could not confirm is worded neutrally in the text.
 */
export const awsScpInheritance = defineWalkthrough({
  id: 'aws-scp-inheritance',
  title: 'Is this API call allowed? Policies inherited down an organisation',
  lead: 'A role in one account calls an API. Service control policies attached to the root, the units above the account and the account itself all apply, and one explicit Deny among them settles it. Then the account is moved to another unit, and the same call gets a different answer.',
  tags: ['aws', 'iam', 'organizations'],

  layout: {
    panes: [
      {
        id: 'org',
        panel: 'tree',
        title: 'Organisation',
        content: {
          nodes: [
            { id: 'root', kind: 'Root', label: 'Root', sub: 'r-example' },
            { id: 'p-root-full', kind: 'SCP', label: 'FullAWSAccess', parent: 'root' },
            { id: 'ou-security', kind: 'OU', label: 'Security', parent: 'root', collapsed: true },
            { id: 'acct-logs', kind: 'acct', label: 'log-archive', parent: 'ou-security' },
            { id: 'acct-audit', kind: 'acct', label: 'audit', parent: 'ou-security' },
            { id: 'ou-workloads', kind: 'OU', label: 'Workloads', parent: 'root' },
            { id: 'p-wl-full', kind: 'SCP', label: 'FullAWSAccess', parent: 'ou-workloads' },
            {
              id: 'p-wl-leave',
              kind: 'SCP',
              label: 'DenyLeaveOrganization',
              sub: 'organizations:LeaveOrganization',
              parent: 'ou-workloads',
            },
            {
              id: 'ou-sandbox',
              kind: 'OU',
              label: 'Sandbox',
              parent: 'ou-workloads',
              collapsed: true,
            },
            { id: 'p-sb-full', kind: 'SCP', label: 'FullAWSAccess', parent: 'ou-sandbox' },
            {
              id: 'p-sb-region',
              kind: 'SCP',
              label: 'DenyOutsideApprovedRegions',
              sub: 'eu-west-1, eu-central-1',
              parent: 'ou-sandbox',
            },
            {
              id: 'acct-sandbox',
              kind: 'acct',
              label: 'sandbox-1',
              sub: '111122223333',
              parent: 'ou-sandbox',
              parents: ['ou-workloads'],
            },
            { id: 'p-acct-full', kind: 'SCP', label: 'FullAWSAccess', parent: 'acct-sandbox' },
            { id: 'acct-web', kind: 'acct', label: 'web-prod', parent: 'ou-workloads' },
            {
              id: 'acct-mgmt',
              kind: 'acct',
              label: 'management',
              sub: 'not restricted by SCPs',
              tone: 'muted',
              parent: 'root',
            },
          ],
        },
      },
      {
        id: 'order',
        panel: 'flow',
        title: 'Evaluation order',
        content: {
          direction: 'DOWN',
          nodes: [
            { id: 'start', label: 'Request arrives', kind: 'terminal' },
            {
              id: 'deny',
              label: 'Explicit Deny in any applicable policy?',
              sub: 'SCP, RCP, resource-based, identity-based, boundary, session',
              kind: 'decision',
            },
            { id: 'denied', label: 'Deny', sub: 'explicit', kind: 'terminal' },
            {
              id: 'rcp',
              label: 'Resource control policies that apply',
              sub: 'none attached in this organisation',
              kind: 'step',
            },
            {
              id: 'scp',
              label: 'Allow in an SCP at every level, root to account?',
              kind: 'decision',
            },
            {
              id: 'rest',
              label: 'Resource-based, identity-based, boundary and session policies allow it?',
              kind: 'decision',
            },
            { id: 'implicit', label: 'Deny', sub: 'implicit', kind: 'terminal' },
            { id: 'allow', label: 'Allow', kind: 'terminal' },
          ],
          edges: [
            { from: 'start', to: 'deny' },
            { from: 'deny', to: 'denied', label: 'yes' },
            { from: 'deny', to: 'rcp', label: 'no' },
            { from: 'rcp', to: 'scp' },
            { from: 'scp', to: 'rest', label: 'yes' },
            { from: 'scp', to: 'implicit', label: 'no' },
            { from: 'rest', to: 'allow', label: 'yes' },
            { from: 'rest', to: 'implicit', label: 'no' },
          ],
        },
      },
      {
        id: 'policy',
        panel: 'payload',
        title: 'The request and the policies',
        content: {
          payloads: [
            {
              id: 'request',
              title: 'Request',
              sub: 'what the policies are evaluated against',
              value: {
                principal: 'arn:aws:iam::111122223333:role/deploy',
                action: 'ec2:RunInstances',
                context: { 'aws:RequestedRegion': 'us-east-1' },
              },
            },
            {
              id: 'region-scp',
              title: 'DenyOutsideApprovedRegions',
              sub: 'service control policy attached to the Sandbox unit',
              value: REGION_POLICY,
            },
            {
              id: 'role-policy',
              title: 'Policy of the role deploy',
              sub: 'identity-based, in account sandbox-1',
              value: {
                Version: '2012-10-17',
                Statement: [{ Effect: 'Allow', Action: ['ec2:RunInstances'], Resource: '*' }],
              },
            },
            {
              id: 'verdict',
              title: 'Result',
              sub: 'who decided',
              value: {
                decision: 'Deny',
                decidedBy: { $ref: 'p-sb-region', text: 'DenyOutsideApprovedRegions' },
              },
              initial: false,
            },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'organisation',
      title: 'The organisation',
      text: 'Policies are attached to nodes of a tree, and a node answers to everything above it.',
      calls: [
        {
          id: 'shape',
          label: 'A root, units and accounts',
          text: 'The root holds units (OU) and accounts. A service control policy (SCP) is attached to the root, to a unit or to an account. An SCP grants nothing: it sets the most that the roles and users below it can be allowed. Every root, unit and account starts with the AWS managed policy FullAWSAccess, which allows everything, so nothing is blocked until an SCP says so. The management account is not restricted by SCPs. Collapsed units say how many nodes they hide.',
          where: `${SCPS} ("SCPs do not grant permissions"; "SCPs don't affect users or roles in the management account"); ${SCP_EVAL} (FullAWSAccess is attached to every root, OU and account when it is created)`,
          effects: { org: [{ read: 'root' }, { read: 'acct-mgmt' }] },
        },
      ],
    },
    {
      id: 'request',
      title: 'One request',
      text: 'A role in sandbox-1 starts an instance in a Region.',
      calls: [
        {
          id: 'request',
          label: 'deploy calls ec2:RunInstances in us-east-1',
          text: 'The request carries the action, the calling role and the Region it was sent to, as the context key aws:RequestedRegion. The tree opens the units above sandbox-1 for this call, because the account sits inside a collapsed unit.',
          where: `${KEYS} (aws:RequestedRegion is always included in the request context)`,
          effects: {
            org: [{ read: 'acct-sandbox' }],
            policy: [{ read: 'request' }],
            order: [{ read: 'start' }],
          },
        },
      ],
    },
    {
      id: 'denied',
      title: 'Evaluated in us-east-1',
      text: 'Which policies apply, and does one of them say no?',
      calls: [
        {
          id: 'collect',
          label: 'The SCPs on the way from the root down',
          text: 'The policies that apply to sandbox-1 are the ones attached to every node on its path: the root, Workloads, Sandbox and the account itself. Policies on other branches, such as anything under Security, do not apply.',
          where: `${SCP_EVAL} ("from the root through each OU in the direct path to the account (including the target account itself)")`,
          effects: {
            org: [
              { read: 'p-root-full' },
              { read: 'p-wl-full' },
              { read: 'p-wl-leave' },
              { read: 'p-sb-full' },
              { read: 'p-sb-region' },
              { read: 'p-acct-full' },
            ],
          },
        },
        {
          id: 'explicit-deny',
          label: 'An explicit Deny settles it',
          text: 'The first check looks for an explicit Deny in any applicable policy. DenyOutsideApprovedRegions applies to every action except those in NotAction, and ec2:RunInstances is not one of them. Its condition is true: us-east-1 is not in the list. So the result is Deny, and the Allow in FullAWSAccess cannot overturn it. A Deny anywhere on the path reaches everything beneath it.',
          where: `${DENY_ALLOW} (an explicit deny overrides an explicit allow; the deny check comes first); ${SCP_EVAL} (any SCP on the path can deny a permission)`,
          effects: {
            org: [{ update: 'p-sb-region', fields: { tone: 'warn' } }],
            order: [{ read: 'deny' }, { read: 'deny.denied' }, { read: 'denied' }],
            policy: [
              {
                read: 'region-scp',
                paths: ['Statement.0.Effect', 'Statement.0.NotAction', 'Statement.0.Condition'],
              },
              { add: 'verdict' },
            ],
          },
        },
      ],
    },
    {
      id: 'allowed',
      title: 'Evaluated in eu-west-1',
      text: 'The same role, the same action, a different Region.',
      calls: [
        {
          id: 'change-region',
          label: 'deploy calls ec2:RunInstances in eu-west-1',
          text: 'Only the Region differs. The earlier result is cleared and the evaluation starts again from the top.',
          effects: {
            org: [{ update: 'p-sb-region', fields: { tone: 'none' } }],
            policy: [
              { update: 'request', fields: { 'context.aws:RequestedRegion': 'eu-west-1' } },
              { remove: 'verdict' },
            ],
            order: [{ read: 'start' }],
          },
        },
        {
          id: 'no-deny',
          label: 'No Deny applies',
          text: 'The condition is false now: eu-west-1 is in the list, so StringNotEquals does not match and the statement does nothing. No other policy denies, so the evaluation moves on. The cited page lists resource control policies before SCPs; there are none in this organisation.',
          where: `${DENY_ALLOW} (the order of the checks: deny evaluation, then resource control policies, SCPs, resource-based, identity-based, permissions boundaries, session policies)`,
          effects: {
            policy: [{ read: 'region-scp', paths: ['Statement.0.Condition'] }],
            order: [{ read: 'deny' }, { read: 'deny.rcp' }, { read: 'rcp' }],
          },
        },
        {
          id: 'scp-allow',
          label: 'Every level allows it',
          text: 'Now the SCPs must allow the action, and a single Allow is not enough: there has to be an Allow at every level from the root down to the account. FullAWSAccess at the root, at Workloads, at Sandbox and on the account provides each one. DenyLeaveOrganization is attached too, but it is about another action.',
          where: `${SCP_EVAL} ("there must be an explicit Allow statement at every level from the root through each OU in the direct path to the account (including the target account itself)")`,
          effects: {
            org: [
              { update: 'p-root-full', fields: { tone: 'good' } },
              { update: 'p-wl-full', fields: { tone: 'good' } },
              { update: 'p-sb-full', fields: { tone: 'good' } },
              { update: 'p-acct-full', fields: { tone: 'good' } },
            ],
            order: [{ read: 'rcp.scp' }, { read: 'scp' }, { read: 'scp.rest' }],
          },
        },
        {
          id: 'identity',
          label: "The role's own policy grants it",
          text: 'The SCPs only said the action is possible. Something has to grant it, and here the identity-based policy of the role does. This demo assumes the role has no permissions boundary and no session policy; how those combine with the others is described on the cited page. Result: Allow.',
          where: `${BASICS}; ${EVAL}. The flowcharts on these pages are images and could not be read for this demo, so the order here follows the text list in ${DENY_ALLOW}`,
          effects: {
            policy: [{ read: 'role-policy', paths: ['Statement.0.Action'] }],
            order: [{ read: 'rest' }, { read: 'rest.allow' }, { read: 'allow' }],
          },
        },
      ],
    },
    {
      id: 'moved',
      title: 'Move the account',
      text: 'Where an account sits decides which policies it inherits.',
      calls: [
        {
          id: 'move',
          label: 'sandbox-1 moves from Sandbox to Workloads',
          text: 'The account moves out of Sandbox, and its own FullAWSAccess goes with it. Sandbox, and DenyOutsideApprovedRegions with it, is no longer on the path from the root to the account. This follows from the inheritance rule above; the page about moving accounts could not be read for this demo.',
          where: `${SCP_EVAL} (the policies that apply come from the root through each OU in the direct path to the account)`,
          effects: { org: [{ update: 'acct-sandbox', fields: { parent: 'ou-workloads' } }] },
        },
        {
          id: 'rerun',
          label: 'The call that was denied now goes through',
          text: "The first request again, in us-east-1. DenyOutsideApprovedRegions is no longer on the path, so no Deny applies. The root, Workloads and the account allow it, and the role's own policy grants it. Allow. Nothing about the role or the call changed, only the place of its account.",
          where: `${SCP_EVAL}; ${DENY_ALLOW}`,
          effects: {
            policy: [
              { update: 'request', fields: { 'context.aws:RequestedRegion': 'us-east-1' } },
              { read: 'role-policy', paths: ['Statement.0.Action'] },
            ],
            org: [
              { read: 'p-root-full' },
              { read: 'p-wl-full' },
              { read: 'p-wl-leave' },
              { read: 'p-acct-full' },
            ],
            order: [{ read: 'deny' }, { read: 'scp' }, { read: 'rest' }, { read: 'allow' }],
          },
        },
      ],
    },
  ],
});
