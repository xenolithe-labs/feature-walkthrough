import { defineWalkthrough } from '../core';

const MAIN_BEFORE = `variable "instance_type" {
  default = "t3.micro"
}

module "network" {
  source = "./modules/network"
}

resource "aws_security_group" "web" {
  vpc_id = module.network.vpc_id
}

resource "aws_instance" "web" {
  ami                    = "ami-0abc1234"
  instance_type          = var.instance_type
  subnet_id              = module.network.subnet_id
  vpc_security_group_ids = [aws_security_group.web.id]
}

resource "aws_eip" "web" {
  instance = aws_instance.web.id
}

output "public_ip" {
  value = aws_eip.web.public_ip
}`;

const MAIN_AFTER = `variable "instance_type" {
  default = "t3.small"
}

module "network" {
  source = "./modules/network"
}

resource "aws_security_group" "web" {
  vpc_id = module.network.vpc_id
}

resource "aws_instance" "web" {
  ami                    = "ami-0abc1234"
  instance_type          = var.instance_type
  subnet_id              = module.network.subnet_id
  vpc_security_group_ids = [aws_security_group.web.id]
}

resource "aws_eip" "web" {
  instance = aws_instance.web.id
}

resource "aws_cloudwatch_metric_alarm" "cpu" {
  alarm_name          = "web-cpu-high"
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  evaluation_periods  = 2
  period              = 300
  statistic           = "Average"
  dimensions          = { InstanceId = aws_instance.web.id }
}

output "public_ip" {
  value = aws_eip.web.public_ip
}`;

const NETWORK = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "subnet_id" {
  value = aws_subnet.app.id
}`;

/**
 * Terraform plan and apply after a small change to the configuration.
 * Resource ids and the AMI are made-up example values.
 */
export const terraformApply = defineWalkthrough({
  id: 'terraform-apply',
  title: 'Terraform: plan and apply one change',
  lead: 'Two edits to a configuration: a bigger instance type and a new alarm. Terraform compares what you wrote with what it recorded last time, and changes only what differs, in dependency order.',
  tags: ['terraform', 'infrastructure'],

  layout: {
    panes: [
      {
        id: 'graph',
        panel: 'graph',
        title: 'Dependency graph',
        content: {
          initial: true,
          direction: 'DOWN',
          nodes: [
            { id: 'var', label: 'var.instance_type' },
            { id: 'vpc', label: 'aws_vpc.main' },
            { id: 'subnet', label: 'aws_subnet.app' },
            { id: 'sg', label: 'aws_security_group.web' },
            { id: 'instance', label: 'aws_instance.web' },
            { id: 'eip', label: 'aws_eip.web' },
            { id: 'alarm', label: 'aws_cloudwatch_metric_alarm.cpu', initial: false },
            { id: 'out', label: 'output.public_ip' },
          ],
          edges: [
            { from: 'vpc', to: 'subnet' },
            { from: 'vpc', to: 'sg' },
            { from: 'var', to: 'instance' },
            { from: 'subnet', to: 'instance' },
            { from: 'sg', to: 'instance' },
            { from: 'instance', to: 'eip' },
            { from: 'instance', to: 'alarm', initial: false },
            { from: 'eip', to: 'out' },
          ],
        },
      },
      {
        id: 'modules',
        panel: 'boxes',
        title: 'Modules',
        content: {
          boxes: [
            { id: 'root', label: 'root module', sub: 'main.tf' },
            { id: 'var', label: 'var.instance_type', parent: 'root', sub: 't3.micro' },
            { id: 'network', label: 'module.network', parent: 'root', sub: 'modules/network' },
            { id: 'vpc', label: 'aws_vpc.main', parent: 'network' },
            { id: 'subnet', label: 'aws_subnet.app', parent: 'network' },
            { id: 'sg', label: 'aws_security_group.web', parent: 'root' },
            { id: 'instance', label: 'aws_instance.web', parent: 'root' },
            { id: 'eip', label: 'aws_eip.web', parent: 'root' },
            {
              id: 'alarm',
              label: 'aws_cloudwatch_metric_alarm.cpu',
              parent: 'root',
              initial: false,
            },
            { id: 'out', label: 'output.public_ip', parent: 'root' },
          ],
        },
      },
      {
        id: 'config',
        panel: 'code',
        title: 'Configuration',
        role: 'focus',
        content: {
          sources: [
            { id: 'main', title: 'main.tf', lang: 'hcl', text: MAIN_BEFORE },
            { id: 'network-tf', title: 'modules/network/main.tf', lang: 'hcl', text: NETWORK },
          ],
        },
      },
      {
        id: 'state',
        panel: 'table',
        title: 'State file',
        role: 'focus',
        content: {
          columns: [
            { id: 'address', label: 'Resource', mono: true },
            { id: 'id', label: 'Real id', mono: true },
            { id: 'attr', label: 'Recorded', mono: true },
            { id: 'action', label: 'Planned' },
          ],
          rows: [
            {
              id: 'vpc',
              cells: {
                address: 'module.network.aws_vpc.main',
                id: 'vpc-0a1',
                attr: 'cidr 10.0.0.0/16',
                action: '',
              },
            },
            {
              id: 'subnet',
              cells: {
                address: 'module.network.aws_subnet.app',
                id: 'subnet-0b2',
                attr: 'cidr 10.0.1.0/24',
                action: '',
              },
            },
            {
              id: 'sg',
              cells: {
                address: 'aws_security_group.web',
                id: 'sg-0c3',
                attr: 'vpc vpc-0a1',
                action: '',
              },
            },
            {
              id: 'instance',
              cells: {
                address: 'aws_instance.web',
                id: 'i-0d4',
                attr: 'type t3.micro',
                action: '',
              },
            },
            {
              id: 'eip',
              cells: {
                address: 'aws_eip.web',
                id: 'eipalloc-0e5',
                attr: 'instance i-0d4',
                action: '',
              },
            },
            {
              id: 'alarm',
              initial: false,
              cells: {
                address: 'aws_cloudwatch_metric_alarm.cpu',
                id: 'web-cpu-high',
                attr: 'threshold 80',
                action: '',
              },
            },
          ],
        },
      },
      {
        id: 'stages',
        panel: 'flow',
        title: 'Stages',
        role: 'focus',
        content: {
          direction: 'RIGHT',
          nodes: [
            { id: 'load', label: 'Load', sub: 'config and state', kind: 'terminal' },
            { id: 'refresh', label: 'Refresh', sub: 'read real resources' },
            { id: 'build', label: 'Build graph' },
            { id: 'diff', label: 'Diff', sub: 'config against state' },
            { id: 'approve', label: 'Approve?', kind: 'decision' },
            { id: 'apply', label: 'Apply', sub: 'in dependency order' },
            { id: 'write', label: 'Write state', kind: 'terminal' },
          ],
          edges: [
            { from: 'load', to: 'refresh' },
            { from: 'refresh', to: 'build' },
            { from: 'build', to: 'diff' },
            { from: 'diff', to: 'approve' },
            { from: 'approve', to: 'apply', label: 'yes' },
            { from: 'apply', to: 'write' },
          ],
        },
      },
    ],
  },

  annotations: {
    status: {
      title: 'Action',
      statuses: {
        none: { label: 'No change', tone: 'neutral' },
        update: { label: 'Update in place', tone: 'warn' },
        create: { label: 'Create', tone: 'good' },
      },
    },
  },

  steps: [
    {
      id: 'edit',
      title: 'Edit',
      text: 'Two changes are made to main.tf. Nothing real has changed yet.',
      calls: [
        {
          id: 'edit-var',
          label: 'Change the instance type',
          text: 'The default of the variable goes from t3.micro to t3.small. The instance does not name the type directly; it reads the variable.',
          show: 'config',
          effects: {
            config: [{ update: 'main', fields: { text: MAIN_AFTER }, lines: [2] }],
            modules: [{ update: 'var', fields: { sub: 't3.small' } }],
            graph: [{ update: 'var' }],
          },
        },
        {
          id: 'edit-alarm',
          label: 'Add an alarm',
          text: 'A new resource block. It refers to the instance’s id, which is how Terraform will learn that the alarm depends on the instance.',
          effects: {
            config: [{ read: 'main', lines: [[24, 34]] }],
            modules: [{ read: 'root' }],
          },
        },
      ],
    },
    {
      id: 'plan-read',
      title: 'Plan: read',
      text: 'terraform plan starts by finding out what exists.',
      calls: [
        {
          id: 'load',
          label: 'Load the configuration and the state',
          text: 'Terraform reads every .tf file, including the network module, and the state file from the last apply. The state maps each resource in the configuration to a real object and records its attributes.',
          show: 'state',
          effects: {
            modules: [{ read: 'root' }, { read: 'network' }],
            state: [
              { read: 'vpc' },
              { read: 'subnet' },
              { read: 'sg' },
              { read: 'instance' },
              { read: 'eip' },
            ],
            stages: [{ read: 'load' }],
          },
        },
        {
          id: 'refresh',
          label: 'Refresh: ask the provider what is really there',
          text: 'For each resource in the state, the provider reads the real object, in case someone changed it outside Terraform. Here everything still matches the state.',
          effects: {
            graph: [
              { read: 'vpc' },
              { read: 'subnet' },
              { read: 'sg' },
              { read: 'instance' },
              { read: 'eip' },
            ],
            state: [
              { read: 'vpc', cells: ['id', 'attr'] },
              { read: 'subnet', cells: ['id', 'attr'] },
              { read: 'sg', cells: ['id', 'attr'] },
              { read: 'instance', cells: ['id', 'attr'] },
              { read: 'eip', cells: ['id', 'attr'] },
            ],
            stages: [{ read: 'refresh' }, { read: 'load.refresh' }],
          },
        },
      ],
    },
    {
      id: 'plan-diff',
      title: 'Plan: compare',
      text: 'Terraform builds a graph from the references between blocks, then visits each node once its dependencies have been visited.',
      calls: [
        {
          id: 'build-graph',
          label: 'Build the graph',
          text: 'Every reference becomes an edge. The alarm joins the graph below the instance, because its dimensions refer to aws_instance.web.id. The resources inside module.network are nodes like any other.',
          show: 'stages',
          effects: {
            graph: [{ add: 'alarm' }, { add: 'instance.alarm' }, { read: 'instance' }],
            modules: [{ add: 'alarm' }],
            stages: [{ read: 'build' }, { read: 'refresh.build' }],
          },
        },
        {
          id: 'diff-network',
          label: 'VPC, subnet, security group: no change',
          text: 'These have no dependencies waiting, so they are visited first. Configuration and state agree for all three.',
          show: 'state',
          effects: {
            graph: [
              { read: 'vpc' },
              { read: 'subnet' },
              { read: 'sg' },
              { read: 'vpc.subnet' },
              { read: 'vpc.sg' },
            ],
            modules: [{ read: 'vpc' }, { read: 'subnet' }, { read: 'sg' }],
            state: [
              { update: 'vpc', fields: { action: 'no change' } },
              { update: 'subnet', fields: { action: 'no change' } },
              { update: 'sg', fields: { action: 'no change' } },
            ],
          },
          annotations: { status: { status: 'none' } },
        },
        {
          id: 'diff-instance',
          label: 'Instance: update in place',
          text: 'The configuration now evaluates to t3.small and the state says t3.micro. The provider reports that this attribute can be changed on the existing instance, so the plan is an update, not a replacement.',
          effects: {
            graph: [
              { read: 'var' },
              { read: 'var.instance' },
              { update: 'instance', fields: { tone: 'warn' } },
            ],
            modules: [{ read: 'var' }, { update: 'instance', fields: { tone: 'warn' } }],
            state: [
              { update: 'instance', fields: { action: 'update: type → t3.small', tone: 'warn' } },
            ],
          },
          annotations: { status: { status: 'update' } },
        },
        {
          id: 'diff-eip',
          label: 'Elastic IP: no change',
          text: 'It depends on the instance, but only on the instance’s id, and an in-place update keeps the id. So nothing downstream needs to change.',
          effects: {
            graph: [
              { read: 'instance.eip' },
              { read: 'eip' },
              { read: 'eip.out' },
              { read: 'out' },
            ],
            modules: [{ read: 'eip' }, { read: 'out' }],
            state: [{ update: 'eip', fields: { action: 'no change' } }],
          },
          annotations: { status: { status: 'none' } },
        },
        {
          id: 'diff-alarm',
          label: 'Alarm: create',
          text: 'The alarm is in the configuration but not in the state, so it has to be created.',
          effects: {
            graph: [{ read: 'instance.alarm' }, { update: 'alarm', fields: { tone: 'good' } }],
            modules: [{ update: 'alarm', fields: { tone: 'good' } }],
            state: [
              { add: 'alarm' },
              {
                update: 'alarm',
                fields: { id: '(known after apply)', action: 'create', tone: 'good' },
              },
            ],
          },
          annotations: { status: { status: 'create' } },
        },
        {
          id: 'show-plan',
          label: 'Show the plan',
          text: 'Nothing has been changed so far. The plan is a list of intended actions, and Terraform waits for a yes.',
          show: 'stages',
          blocks: [
            {
              title: 'terraform plan',
              text: '  # aws_instance.web will be updated in-place\n  ~ resource "aws_instance" "web" {\n      ~ instance_type = "t3.micro" -> "t3.small"\n    }\n\n  # aws_cloudwatch_metric_alarm.cpu will be created\n  + resource "aws_cloudwatch_metric_alarm" "cpu" {\n      + alarm_name = "web-cpu-high"\n      + threshold  = 80\n    }\n\nPlan: 1 to add, 1 to change, 0 to destroy.',
            },
          ],
          effects: {
            graph: [{ read: 'instance' }, { read: 'alarm' }],
            stages: [{ read: 'diff' }, { read: 'diff.approve' }, { read: 'approve' }],
          },
        },
      ],
    },
    {
      id: 'apply',
      title: 'Apply',
      text: 'After approval, Terraform walks the same graph again and carries out the planned actions. A resource is only started when everything it depends on is finished.',
      calls: [
        {
          id: 'apply-instance',
          label: 'Update the instance',
          text: 'The provider changes the instance type through the cloud API. The alarm has to wait for this: it depends on the instance.',
          show: 'state',
          effects: {
            graph: [{ update: 'instance', fields: { tone: 'none' } }],
            modules: [{ update: 'instance', fields: { tone: 'none' } }],
            state: [
              {
                update: 'instance',
                fields: { attr: 'type t3.small', action: 'done', tone: 'none' },
              },
            ],
            stages: [{ read: 'approve.apply' }, { read: 'apply' }],
          },
          annotations: { status: { status: 'update' } },
        },
        {
          id: 'apply-alarm',
          label: 'Create the alarm',
          text: 'The instance is finished, so the alarm can be created. Its real id is only known now, and goes into the state.',
          effects: {
            graph: [{ read: 'instance.alarm' }, { update: 'alarm', fields: { tone: 'none' } }],
            modules: [{ update: 'alarm', fields: { tone: 'none' } }],
            state: [
              { update: 'alarm', fields: { id: 'web-cpu-high', action: 'done', tone: 'none' } },
            ],
            stages: [{ read: 'apply' }],
          },
          annotations: { status: { status: 'create' } },
        },
        {
          id: 'write-state',
          label: 'Write the state',
          text: 'The state now records six resources, with the new instance type and the alarm. The next plan will compare against this, and with no further edits it will report no changes.',
          blocks: [
            {
              title: 'terraform apply',
              text: 'Apply complete! Resources: 1 added, 1 changed, 0 destroyed.\n\nOutputs:\n\npublic_ip = "203.0.113.10"',
            },
          ],
          effects: {
            graph: [{ read: 'out' }],
            state: [{ read: 'instance', cells: ['attr'] }, { read: 'alarm' }],
            stages: [{ read: 'apply.write' }, { read: 'write' }],
          },
        },
      ],
    },
  ],
});
